/**
 * Explainable personalization (PROMPT M9).
 *
 * Adjusts match ranking using the user's own feedback history —
 * no machine learning, every adjustment has a readable reason.
 *
 * Signals used:
 *  - saved jobs → their companies/titles get a boost
 *  - not-relevant jobs → their companies/titles get a penalty
 *  - applied jobs → same-company jobs get a small boost (momentum)
 *
 * The adjustment is a bounded delta applied to stored match scores,
 * never overriding hard filters or the notification threshold semantics.
 */

import { PrismaClient } from '@prisma/client';
import { normalizeText } from '@job-hunter/core';

export interface PersonalizationAdjustment {
  matchId: string;
  originalScore: number;
  adjustedScore: number;
  delta: number;
  reasons: string[];
}

export interface PersonalizationStats {
  adjusted: number;
  signalsConsidered: number;
}

export interface PersonalizationOptions {
  /** Max absolute score delta per match (bounded adjustments). */
  maxDelta: number;
  /** Weight per signal occurrence (before capping). */
  companySavedWeight: number;
  companyRejectedWeight: number;
  titleSavedWeight: number;
  titleRejectedWeight: number;
  appliedBoost: number;
}

export const DEFAULT_PERSONALIZATION_OPTIONS: PersonalizationOptions = {
  maxDelta: 10,
  companySavedWeight: 3,
  companyRejectedWeight: -3,
  titleSavedWeight: 2,
  titleRejectedWeight: -2,
  appliedBoost: 2,
};

interface SignalIndex {
  /** normalized company → {saved, rejected, applied} counts */
  companies: Map<string, { saved: number; rejected: number; applied: number }>;
  /** normalized title → {saved, rejected} counts */
  titles: Map<string, { saved: number; rejected: number }>;
  total: number;
}

export class PersonalizationEngine {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: PersonalizationOptions = DEFAULT_PERSONALIZATION_OPTIONS,
  ) {}

  /** Build the user's feedback signal index (their own history only). */
  private async buildIndex(userId: string): Promise<SignalIndex> {
    const feedback = await this.prisma.feedback.findMany({
      where: { userId },
      include: { job: { select: { title: true, company: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const index: SignalIndex = {
      companies: new Map(),
      titles: new Map(),
      total: feedback.length,
    };

    for (const fb of feedback) {
      const companyKey = normalizeText(fb.job.company);
      const titleKey = normalizeText(fb.job.title.split(' ')[0] ?? '');

      const c = index.companies.get(companyKey) ?? { saved: 0, rejected: 0, applied: 0 };
      const t = index.titles.get(titleKey) ?? { saved: 0, rejected: 0 };

      if (fb.action === 'saved') {
        c.saved++;
        t.saved++;
      } else if (fb.action === 'not_relevant') {
        c.rejected++;
        t.rejected++;
      } else if (fb.action === 'applied' || fb.action === 'interested') {
        c.applied++;
      }

      index.companies.set(companyKey, c);
      index.titles.set(titleKey, t);
    }

    return index;
  }

  /**
   * Re-rank the user's current 'new' matches with explainable adjustments.
   * Returns the adjustments (and persists adjusted scores + reasons).
   */
  async rerank(
    userId: string,
    limit = 50,
  ): Promise<{
    stats: PersonalizationStats;
    adjustments: PersonalizationAdjustment[];
  }> {
    const index = await this.buildIndex(userId);
    const matches = await this.prisma.jobMatch.findMany({
      where: { status: 'new', searchProfile: { userId } },
      include: { job: { select: { title: true, company: true } } },
      orderBy: { score: 'desc' },
      take: limit,
    });

    const adjustments: PersonalizationAdjustment[] = [];
    const opts = this.options;

    for (const match of matches) {
      const companyKey = normalizeText(match.job.company);
      const titleKey = normalizeText(match.job.title.split(' ')[0] ?? '');
      const c = index.companies.get(companyKey);
      const t = index.titles.get(titleKey);

      let delta = 0;
      const reasons: string[] = [];

      if (c?.saved) {
        delta += opts.companySavedWeight * c.saved;
        reasons.push(`you saved ${c.saved} job(s) at ${match.job.company}`);
      }
      if (c?.rejected) {
        delta += opts.companyRejectedWeight * c.rejected;
        reasons.push(`you marked ${c.rejected} job(s) at ${match.job.company} not relevant`);
      }
      if (c?.applied) {
        delta += opts.appliedBoost;
        reasons.push(`you already applied at ${match.job.company}`);
      }
      if (t?.saved) {
        delta += opts.titleSavedWeight * t.saved;
        reasons.push(`you saved ${t.saved} similar "${titleKey}" job(s)`);
      }
      if (t?.rejected) {
        delta += opts.titleRejectedWeight * t.rejected;
        reasons.push(`you marked ${t.rejected} similar "${titleKey}" job(s) not relevant`);
      }

      if (delta === 0) continue;

      // Bounded delta, clamped final score.
      const bounded = Math.max(-opts.maxDelta, Math.min(opts.maxDelta, delta));
      const adjusted = Math.max(0, Math.min(100, match.score + bounded));

      if (adjusted === match.score) continue;

      await this.prisma.jobMatch.update({
        where: { id: match.id },
        data: {
          score: adjusted,
          explanation: reasons.length
            ? `${match.explanation} | Personalized: ${reasons.join('; ')} (${bounded > 0 ? '+' : ''}${bounded})`
            : match.explanation,
        },
      });

      adjustments.push({
        matchId: match.id,
        originalScore: match.score,
        adjustedScore: adjusted,
        delta: bounded,
        reasons,
      });
    }

    return {
      stats: { adjusted: adjustments.length, signalsConsidered: index.total },
      adjustments,
    };
  }
}

/** Status transitions for saved/ignored/interested/applied (PROMPT M9). */
export const MATCH_STATUS_TRANSITIONS: Record<string, string[]> = {
  new: ['saved', 'not_relevant', 'notified'],
  notified: ['saved', 'not_relevant', 'applied', 'interested'],
  saved: ['applied', 'not_relevant'],
  applied: [],
  interested: ['applied', 'not_relevant'],
  not_relevant: [],
  rejected: [],
};

export function canTransition(from: string, to: string): boolean {
  return MATCH_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
