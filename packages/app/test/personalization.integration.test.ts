import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  PersonalizationEngine,
  canTransition,
  DEFAULT_PERSONALIZATION_OPTIONS,
} from '../src/personalization/engine.js';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

d('PersonalizationEngine (M9)', () => {
  let prisma: PrismaClient;
  let engine: PersonalizationEngine;
  let userId: string;
  let profileId: string;
  let candidateId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    engine = new PersonalizationEngine(prisma);

    const user = await prisma.user.create({
      data: { email: `pers-${Date.now()}@example.com` },
    });
    userId = user.id;
    await prisma.jobSource.upsert({
      where: { id: 'jobvision' },
      create: { id: 'jobvision', name: 'JobVision' },
      update: {},
    });
    profileId = (
      await prisma.searchProfile.create({
        data: {
          userId,
          name: 'pers',
          targetTitles: [],
          requiredKeywords: [],
          preferredKeywords: [],
          excludedKeywords: [],
          locations: [],
          employmentTypes: [],
          remotePolicies: [],
          minimumMatchScore: 10,
        },
      })
    ).id;
    candidateId = (await prisma.candidateProfile.create({ data: { userId, profile: {} } })).id;
  });

  afterAll(async () => {
    const jobs = await prisma.job.findMany({
      where: { sourceId: 'jobvision', title: { startsWith: 'pers-' } },
    });
    for (const j of jobs) {
      await prisma.jobMatch.deleteMany({ where: { jobId: j.id } });
      await prisma.feedback.deleteMany({ where: { jobId: j.id } });
      await prisma.job.delete({ where: { id: j.id } }).catch(() => null);
    }
    await prisma.searchProfile.delete({ where: { id: profileId } }).catch(() => null);
    await prisma.candidateProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    await prisma.$disconnect();
  });

  async function seedJob(title: string, company: string): Promise<string> {
    const job = await prisma.job.create({
      data: {
        logicalKey: `pers-${title}-${Date.now()}-${Math.random()}`,
        title,
        company,
        description: 'd',
        contentHash: `hash-${Math.random()}`,
        sourceId: 'jobvision',
        externalId: `ext-${Math.random()}`,
        canonicalUrl: `https://x/${Math.random()}`,
      },
    });
    return job.id;
  }

  async function seedMatch(jobId: string, score: number, status = 'new'): Promise<string> {
    const m = await prisma.jobMatch.create({
      data: {
        jobId,
        searchProfileId: profileId,
        candidateProfileId: candidateId,
        score,
        recommendation: 'good_match',
        matchedSkills: [],
        missingSkills: [],
        explanation: 'test',
        status,
      },
    });
    return m.id;
  }

  it('boosts companies/titles the user saved and penalizes rejected ones', async () => {
    // Feedback history: saved a job at Acme, rejected one at Legacy Co
    const savedJob = await seedJob('pers-Saved Developer', 'Acme Corp');
    const rejectedJob = await seedJob('pers-Saved Developer', 'Legacy Co');
    await prisma.feedback.create({ data: { userId, jobId: savedJob, action: 'saved' } });
    await prisma.feedback.create({
      data: { userId, jobId: rejectedJob, action: 'not_relevant' },
    });

    // New matches to re-rank
    const acmeNew = await seedJob('pers-Backend Developer', 'Acme Corp');
    const legacyNew = await seedJob('pers-Backend Developer', 'Legacy Co');
    const acmeMatch = await seedMatch(acmeNew, 60);
    const legacyMatch = await seedMatch(legacyNew, 60);

    const { stats, adjustments } = await engine.rerank(userId);

    const acmeAdj = adjustments.find((a) => a.matchId === acmeMatch);
    const legacyAdj = adjustments.find((a) => a.matchId === legacyMatch);
    expect(acmeAdj).toBeDefined();
    expect(acmeAdj!.delta).toBeGreaterThan(0);
    expect(acmeAdj!.reasons.join(' ')).toContain('Acme Corp');

    expect(legacyAdj).toBeDefined();
    expect(legacyAdj!.delta).toBeLessThan(0);
    expect(legacyAdj!.reasons.join(' ')).toContain('Legacy Co');
    expect(stats.adjusted).toBeGreaterThanOrEqual(2);

    const acmeRow = await prisma.jobMatch.findUnique({ where: { id: acmeMatch } });
    expect(acmeRow?.score).toBeGreaterThan(60);
    expect(acmeRow?.explanation).toContain('Personalized');
  });

  it('caps adjustments within maxDelta', async () => {
    // Many saved jobs at one company → delta would exceed maxDelta
    for (let i = 0; i < 10; i++) {
      const j = await seedJob(`pers-bulk-${i}`, 'Bulk Corp');
      await prisma.feedback.create({ data: { userId, jobId: j, action: 'saved' } });
    }
    const bulkNew = await seedJob('pers-Backend Developer', 'Bulk Corp');
    const bulkMatch = await seedMatch(bulkNew, 50);

    const { adjustments } = await engine.rerank(userId);
    const bulkAdj = adjustments.find((a) => a.matchId === bulkMatch);
    expect(bulkAdj).toBeDefined();
    expect(Math.abs(bulkAdj!.delta)).toBeLessThanOrEqual(DEFAULT_PERSONALIZATION_OPTIONS.maxDelta);
    expect(bulkAdj!.adjustedScore).toBe(50 + DEFAULT_PERSONALIZATION_OPTIONS.maxDelta);
  });

  it('makes no adjustments without feedback history', async () => {
    const other = await prisma.user.create({
      data: { email: `pers-empty-${Date.now()}@example.com` },
    });
    const { adjustments } = await engine.rerank(other.id);
    expect(adjustments).toEqual([]);
    await prisma.user.delete({ where: { id: other.id } });
  });

  it('applied-company jobs get a small boost with readable reason', async () => {
    const appliedJob = await seedJob('pers-Applied Developer', 'Momentum Co');
    await prisma.feedback.create({
      data: { userId, jobId: appliedJob, action: 'applied' },
    });
    const momentumNew = await seedJob('pers-Backend Developer', 'Momentum Co');
    const m = await seedMatch(momentumNew, 55);

    const { adjustments } = await engine.rerank(userId);
    const adj = adjustments.find((a) => a.matchId === m);
    expect(adj).toBeDefined();
    expect(adj!.delta).toBe(DEFAULT_PERSONALIZATION_OPTIONS.appliedBoost);
    expect(adj!.reasons.join(' ')).toContain('already applied');
  });
});

describe('canTransition (match status machine)', () => {
  it('allows sensible transitions and blocks terminal ones', () => {
    expect(canTransition('new', 'saved')).toBe(true);
    expect(canTransition('notified', 'applied')).toBe(true);
    expect(canTransition('saved', 'applied')).toBe(true);
    expect(canTransition('saved', 'not_relevant')).toBe(true);
    expect(canTransition('applied', 'saved')).toBe(false);
    expect(canTransition('applied', 'not_relevant')).toBe(false);
    expect(canTransition('not_relevant', 'saved')).toBe(false);
    expect(canTransition('rejected', 'saved')).toBe(false);
  });
});
