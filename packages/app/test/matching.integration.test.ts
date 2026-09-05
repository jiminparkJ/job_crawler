import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { MatchService, toCoreSearchProfile } from '../src/pipeline/matching.js';
import { JobRepository } from '../src/repositories/jobRepository.js';
import type { NormalizedJob } from '@job-hunter/core';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

d('MatchService (M5 wiring)', () => {
  let prisma: PrismaClient;
  let matchService: MatchService;
  let repo: JobRepository;
  let userId: string;
  let profileId: string;
  const jobIds: string[] = [];

  const GOOD_JOB: Partial<NormalizedJob> = {
    title: 'Senior Backend Developer',
    company: 'Match Test Co',
    description: 'Node.js TypeScript PostgreSQL Docker microservices backend',
    location: 'Tehran',
    employmentType: 'full_time',
  };

  const BAD_JOB: Partial<NormalizedJob> = {
    title: 'PHP WordPress Developer',
    company: 'Old Tech',
    description: 'PHP WordPress maintenance, theme development',
    location: 'Shiraz',
    employmentType: 'part_time',
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    matchService = new MatchService(prisma);
    repo = new JobRepository(prisma);

    const user = await prisma.user.create({
      data: { email: `match-test-${Date.now()}@example.com` },
    });
    userId = user.id;
    profileId = (
      await prisma.searchProfile.create({
        data: {
          userId,
          name: 'Backend Jobs',
          targetTitles: ['Backend Developer', 'Backend Engineer'],
          requiredKeywords: ['Node.js'],
          preferredKeywords: ['PostgreSQL', 'Docker'],
          excludedKeywords: ['PHP', 'WordPress'],
          locations: ['Tehran', 'Remote'],
          employmentTypes: ['full_time'],
          remotePolicies: [],
          minimumMatchScore: 50,
        },
      })
    ).id;

    // Seed two jobs: one strong match, one hard-filter reject
    const good = await repo.upsertJob({
      ...(GOOD_JOB as NormalizedJob),
      id: 'jobvision:m-good',
      source: 'jobvision',
      externalId: `m-good-${Date.now()}`,
      url: `https://jobvision.ir/jobs/m-good-${Date.now()}`,
    });
    const bad = await repo.upsertJob({
      ...(BAD_JOB as NormalizedJob),
      id: 'jobvision:m-bad',
      source: 'jobvision',
      externalId: `m-bad-${Date.now()}`,
      url: `https://jobvision.ir/jobs/m-bad-${Date.now()}`,
    });
    jobIds.push(good.jobId, bad.jobId);
  });

  afterAll(async () => {
    await prisma.jobMatch.deleteMany({ where: { searchProfileId: profileId } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.searchProfile.delete({ where: { id: profileId } }).catch(() => null);
    await prisma.candidateProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    await prisma.$disconnect();
  });

  it('matches jobs against active search profiles and persists results', async () => {
    const stats = await matchService.runMatching({ jobIds });

    expect(stats.jobsConsidered).toBe(2);
    expect(stats.profilesConsidered).toBe(1);
    expect(stats.matchesCreated).toBe(2);

    const matches = await prisma.jobMatch.findMany({
      where: { searchProfileId: profileId },
      include: { job: true },
    });
    expect(matches).toHaveLength(2);

    const good = matches.find((m) => m.job.title.includes('Backend'));
    const bad = matches.find((m) => m.job.title.includes('PHP'));

    expect(good?.status).toBe('new');
    expect(good?.score).toBeGreaterThanOrEqual(50);
    expect(good?.matchedSkills).toContain('PostgreSQL');
    expect(good?.recommendation).not.toBe('no_match');

    expect(bad?.status).toBe('rejected');
    expect(bad?.recommendation).toBe('no_match');
  });

  it('re-running matching is idempotent (updates, no duplicates)', async () => {
    const stats = await matchService.runMatching({ jobIds });
    expect(stats.matchesCreated).toBe(0);
    expect(stats.matchesUpdated).toBe(2);

    const count = await prisma.jobMatch.count({ where: { searchProfileId: profileId } });
    expect(count).toBe(2);
  });

  it('preserves user feedback statuses across re-matches', async () => {
    const matches = await prisma.jobMatch.findMany({
      where: { searchProfileId: profileId },
    });
    const good = matches.find((m) => m.status === 'new');
    expect(good).toBeDefined();
    await prisma.jobMatch.update({
      where: { id: good!.id },
      data: { status: 'saved' },
    });

    await matchService.runMatching({ jobIds });

    const after = await prisma.jobMatch.findUnique({ where: { id: good!.id } });
    expect(after?.status).toBe('saved'); // feedback not overwritten
  });

  it('pendingNotificationMatches returns new matches ordered by score', async () => {
    // Restore the good match to 'new' (a prior test set it to 'saved').
    await prisma.jobMatch.updateMany({
      where: { searchProfileId: profileId, status: 'saved' },
      data: { status: 'new' },
    });
    const pending = await matchService.pendingNotificationMatches(100);
    const ours = pending.filter((p) => jobIds.includes(p.jobId));
    expect(ours).toHaveLength(1); // only the good job
    const matchRow = await prisma.jobMatch.findFirst({
      where: { jobId: ours[0].jobId, searchProfileId: profileId },
    });
    expect(matchRow?.score).toBeGreaterThanOrEqual(50);
  });

  it('toCoreSearchProfile maps DB row fields to engine profile', () => {
    const core = toCoreSearchProfile({
      id: 'sp1',
      targetTitles: ['Backend Developer'],
      requiredKeywords: ['Node.js'],
      preferredKeywords: [],
      excludedKeywords: ['PHP'],
      locations: ['Tehran'],
      employmentTypes: ['full_time'],
      remotePolicies: ['remote'],
      minimumYearsExp: 3,
      minimumMatchScore: 75,
      minSalary: null,
      salaryCurrency: null,
    });
    expect(core.targetTitles).toEqual(['Backend Developer']);
    expect(core.minimumMatchScore).toBe(75);
    expect(core.employmentTypes).toEqual(['full_time']);
  });
});
