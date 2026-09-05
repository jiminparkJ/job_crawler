import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NotificationService } from '../src/telegram/notificationService.js';
import type { TelegramClient, TelegramMessageOptions, TgUpdate } from '../src/telegram/client.js';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

/** Fake Telegram client: records sends, can simulate failures. */
class FakeTelegram implements TelegramClient {
  sent: TelegramMessageOptions[] = [];
  failNext = 0;

  async sendMessage(options: TelegramMessageOptions) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('429 Too Many Requests: retry after 30');
    }
    this.sent.push(options);
    return { message_id: this.sent.length, chat: { id: 1 }, date: Date.now() / 1000 };
  }

  async getWebhookInfo() {
    return { url: '', pending_update_count: 0 };
  }
  async deleteWebhook() {
    return true;
  }
  async getUpdates(): Promise<TgUpdate[]> {
    return [];
  }
  async answerCallbackQuery() {
    return true;
  }
}

d('NotificationService (M6)', () => {
  let prisma: PrismaClient;
  let tg: FakeTelegram;
  let service: NotificationService;
  let userId: string;
  let profileId: string;
  let candidateProfileId: string;
  let jobId: string;
  let matchId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    tg = new FakeTelegram();
    service = new NotificationService({ prisma, telegram: tg, chatId: '12345' });

    const user = await prisma.user.create({
      data: { email: `tg-test-${Date.now()}@example.com`, telegram: '12345' },
    });
    userId = user.id;
    await prisma.jobSource.upsert({
      where: { id: 'jobvision' },
      create: { id: 'jobvision', name: 'JobVision' },
      update: {},
    });
    const profile = await prisma.searchProfile.create({
      data: {
        userId,
        name: 'Backend',
        targetTitles: ['Backend Developer'],
        requiredKeywords: [],
        preferredKeywords: [],
        excludedKeywords: [],
        locations: [],
        employmentTypes: [],
        remotePolicies: [],
        minimumMatchScore: 50,
      },
    });
    profileId = profile.id;
    const cand = await prisma.candidateProfile.create({
      data: { userId, profile: {} },
    });
    candidateProfileId = cand.id;
    const job = await prisma.job.create({
      data: {
        logicalKey: `tg-test-${Date.now()}`,
        title: 'Backend Developer',
        company: 'TG Test Co',
        description: 'Node.js role',
        contentHash: `tg-hash-${Date.now()}`,
        sourceId: 'jobvision',
        externalId: `tg-${Date.now()}`,
        canonicalUrl: 'https://jobvision.ir/jobs/tgtest',
        salaryMin: 450_000_000,
        salaryMax: 600_000_000,
        salaryCurrency: 'IRR',
      },
    });
    jobId = job.id;
    const match = await prisma.jobMatch.create({
      data: {
        jobId,
        searchProfileId: profileId,
        candidateProfileId,
        score: 88,
        recommendation: 'strong_match',
        matchedSkills: ['Node.js'],
        missingSkills: ['Kubernetes'],
        explanation: 'Strong backend overlap.',
        status: 'new',
      },
    });
    matchId = match.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.feedback.deleteMany({ where: { userId } });
    await prisma.jobMatch.deleteMany({ where: { searchProfileId: profileId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.searchProfile.delete({ where: { id: profileId } });
    await prisma.candidateProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    await prisma.$disconnect();
  });

  it('sends a notification for a pending match and persists the interaction', async () => {
    const stats = await service.notifyPendingMatches();

    expect(stats.considered).toBeGreaterThanOrEqual(1);
    expect(stats.sent).toBeGreaterThanOrEqual(1);
    expect(tg.sent).toHaveLength(1);

    const msg = tg.sent[0];
    expect(msg.chatId).toBe('12345');
    expect(msg.text).toContain('88% MATCH');
    expect(msg.text).toContain('Backend Developer');
    expect(msg.text).toContain('45-60 T'); // salary converted to Tomans
    expect(msg.text).toContain('🔗 View Job');
    expect(msg.replyMarkup?.inline_keyboard[0][0].callback_data).toBe(`save:${matchId}`);

    const notif = await prisma.notification.findFirst({
      where: { userId, jobId, channel: 'telegram' },
    });
    expect(notif?.status).toBe('sent');
    expect(notif?.sentAt).not.toBeNull();

    const matchRow = await prisma.jobMatch.findUnique({ where: { id: matchId } });
    expect(matchRow?.status).toBe('notified');
  });

  it('never sends duplicate notifications for the same job (dedup)', async () => {
    // Reset match to new (simulate re-match) — notification must be skipped.
    await prisma.jobMatch.update({ where: { id: matchId }, data: { status: 'new' } });
    const before = tg.sent.length;
    const stats = await service.notifyPendingMatches();

    expect(stats.skippedDuplicates).toBeGreaterThanOrEqual(1);
    expect(stats.sent).toBe(0);
    expect(tg.sent.length).toBe(before);
  });

  it('keeps match persisted when Telegram fails, and retries later', async () => {
    await prisma.notification.deleteMany({ where: { userId, jobId } });
    await prisma.jobMatch.update({ where: { id: matchId }, data: { status: 'new' } });

    tg.failNext = 1;
    const failStats = await service.notifyPendingMatches();
    expect(failStats.failed).toBe(1);
    expect(failStats.sent).toBe(0);

    // Job + match still persisted; notification pending with error recorded
    const pendingNotif = await prisma.notification.findFirst({
      where: { userId, jobId, status: 'pending' },
    });
    expect(pendingNotif?.attempts).toBe(1);
    expect(pendingNotif?.error).toMatch(/429/);

    // Retry succeeds
    const retried = await service.retryFailedNotifications();
    expect(retried).toBe(1);
    const sentNotif = await prisma.notification.findFirst({
      where: { userId, jobId },
    });
    expect(sentNotif?.status).toBe('sent');
    const matchRow = await prisma.jobMatch.findUnique({ where: { id: matchId } });
    expect(matchRow?.status).toBe('notified');
  });

  it('handles Save callback: persists feedback and updates match status', async () => {
    const result = await service.handleCallback(`save:${matchId}`, 999);
    expect(result).toBe('saved');

    const matchRow = await prisma.jobMatch.findUnique({ where: { id: matchId } });
    expect(matchRow?.status).toBe('saved');

    const feedback = await prisma.feedback.findFirst({
      where: { userId, jobId, action: 'saved' },
    });
    expect(feedback).not.toBeNull();
  });

  it('handles Not Relevant callback', async () => {
    const result = await service.handleCallback(`not_relevant:${matchId}`, 999);
    expect(result).toBe('not_relevant');
    const matchRow = await prisma.jobMatch.findUnique({ where: { id: matchId } });
    expect(matchRow?.status).toBe('not_relevant');
  });

  it('ignores malformed or unknown callback data', async () => {
    expect(await service.handleCallback('bogus', 999)).toBe('ignored');
    expect(await service.handleCallback('save:nonexistent-id', 999)).toBe('ignored');
  });
});
