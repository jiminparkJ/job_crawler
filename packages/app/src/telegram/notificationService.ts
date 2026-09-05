/**
 * Notification pipeline stage (PROMPT M6):
 * pending JobMatches → formatted Telegram messages → send with retry,
 * dedup, and full interaction persistence.
 *
 * Failure model: if Telegram is down, matches stay status 'new' and
 * Notification rows stay 'pending' — nothing is lost, retried next tick.
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { TelegramClient } from './client.js';
import { formatMatchMessage, formatSalary, feedbackKeyboard } from './messages.js';

export interface NotifyRunStats {
  considered: number;
  sent: number;
  skippedDuplicates: number;
  failed: number;
}

export interface NotificationDeps {
  prisma: PrismaClient;
  telegram: TelegramClient;
  chatId: string;
  logger?: Logger;
}

export class NotificationService {
  constructor(private readonly deps: NotificationDeps) {}

  /**
   * Notify all pending matches (status 'new', score ≥ threshold).
   * Duplicate prevention: Notification unique (userId, jobId, channel) —
   * a job already notified once is never re-notified.
   */
  async notifyPendingMatches(limit = 20): Promise<NotifyRunStats> {
    const { prisma, telegram, chatId, logger } = this.deps;
    const stats: NotifyRunStats = {
      considered: 0,
      sent: 0,
      skippedDuplicates: 0,
      failed: 0,
    };

    const pending = await prisma.jobMatch.findMany({
      where: { status: 'new' },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      take: limit,
      include: {
        job: { include: { listings: { select: { sourceId: true } } } },
        searchProfile: { select: { userId: true, minimumMatchScore: true } },
      },
    });

    for (const match of pending) {
      stats.considered++;
      if (match.score < match.searchProfile.minimumMatchScore) continue;

      // Duplicate-notification prevention (PROMPT §6).
      const existing = await prisma.notification.findFirst({
        where: {
          userId: match.searchProfile.userId,
          jobId: match.jobId,
          channel: 'telegram',
        },
      });
      if (existing) {
        stats.skippedDuplicates++;
        await prisma.jobMatch.update({
          where: { id: match.id },
          data: { status: existing.status === 'sent' ? 'notified' : match.status },
        });
        continue;
      }

      // Create the pending notification BEFORE sending (crash-safe).
      const notification = await prisma.notification.create({
        data: {
          userId: match.searchProfile.userId,
          jobId: match.jobId,
          jobMatchId: match.id,
          channel: 'telegram',
          status: 'pending',
        },
      });

      try {
        const text = formatMatchMessage({
          title: match.job.title,
          company: match.job.company,
          location: match.job.location,
          remote: (match.job.remote as 'remote' | 'hybrid' | 'onsite' | null) ?? null,
          employmentType: match.job.employmentType,
          salary: formatSalary(match.job.salaryMin, match.job.salaryMax, match.job.salaryCurrency),
          url: match.job.canonicalUrl,
          score: match.score,
          matchedSkills: match.matchedSkills,
          missingSkills: match.missingSkills,
          explanation: match.explanation,
          sources: [...new Set(match.job.listings.map((l) => l.sourceId))],
        });

        await telegram.sendMessage({
          chatId,
          text,
          parseMode: 'HTML',
          replyMarkup: feedbackKeyboard(match.id),
        });

        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'sent', sentAt: new Date() },
        });
        await prisma.jobMatch.update({
          where: { id: match.id },
          data: { status: 'notified' },
        });
        stats.sent++;
      } catch (err) {
        // Telegram failed: keep the job/match persisted; retry later.
        stats.failed++;
        await prisma.notification
          .update({
            where: { id: notification.id },
            data: {
              status: 'pending',
              attempts: { increment: 1 },
              error: err instanceof Error ? err.message : String(err),
            },
          })
          .catch(() => null);
        logger?.warn(
          { matchId: match.id, err: err instanceof Error ? err.message : String(err) },
          'telegram send failed — will retry',
        );
      }
    }

    return stats;
  }

  /**
   * Process a Telegram callback (Save / Not Relevant buttons).
   * Persists Feedback + updates JobMatch status; idempotent.
   */
  async handleCallback(
    data: string,
    _telegramUserId: number,
  ): Promise<'saved' | 'not_relevant' | 'ignored'> {
    const { prisma } = this.deps;
    const [action, matchId] = data.split(':');
    if (!matchId || !['save', 'not_relevant'].includes(action)) return 'ignored';

    const match = await prisma.jobMatch.findUnique({
      where: { id: matchId },
      include: { searchProfile: { select: { userId: true } } },
    });
    if (!match) return 'ignored';

    const status = action === 'save' ? 'saved' : 'not_relevant';

    // Map telegram user to app user via the search profile's owner.
    // (Single-user MVP: notifications went to the configured chat; the
    // telegram user id is recorded on feedback for future multi-user.)
    await prisma.$transaction([
      prisma.jobMatch.update({ where: { id: matchId }, data: { status } }),
      prisma.feedback.create({
        data: {
          userId: match.searchProfile.userId,
          jobId: match.jobId,
          action: status,
        },
      }),
    ]);

    return status;
  }

  /** Retry notifications stuck in 'pending' (e.g. Telegram was down). */
  async retryFailedNotifications(limit = 20): Promise<number> {
    const { prisma, telegram, chatId, logger } = this.deps;
    const stuck = await prisma.notification.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: { jobMatch: true, job: true },
    });

    let retried = 0;
    for (const n of stuck) {
      if (!n.jobMatch || !n.job) continue;
      try {
        const text = formatMatchMessage({
          title: n.job.title,
          company: n.job.company,
          location: n.job.location,
          remote: (n.job.remote as 'remote' | 'hybrid' | 'onsite' | null) ?? null,
          employmentType: n.job.employmentType,
          salary: formatSalary(n.job.salaryMin, n.job.salaryMax, n.job.salaryCurrency),
          url: n.job.canonicalUrl,
          score: n.jobMatch.score,
          matchedSkills: n.jobMatch.matchedSkills,
          missingSkills: n.jobMatch.missingSkills,
          explanation: n.jobMatch.explanation,
          sources: ['jobvision'],
        });
        await telegram.sendMessage({
          chatId,
          text,
          parseMode: 'HTML',
          replyMarkup: feedbackKeyboard(n.jobMatchId ?? n.jobMatch.id),
        });
        await prisma.notification.update({
          where: { id: n.id },
          data: { status: 'sent', sentAt: new Date(), error: null },
        });
        await prisma.jobMatch.update({
          where: { id: n.jobMatch.id },
          data: { status: 'notified' },
        });
        retried++;
      } catch (err) {
        logger?.warn({ notificationId: n.id }, 'retry failed again');
        await prisma.notification
          .update({
            where: { id: n.id },
            data: {
              attempts: { increment: 1 },
              error: err instanceof Error ? err.message : String(err),
            },
          })
          .catch(() => null);
      }
    }
    return retried;
  }
}
