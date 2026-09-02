import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Database integration test — requires a reachable PostgreSQL.
 * Skipped automatically when TEST_DATABASE_URL is not set.
 */
const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

d('database schema', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists a full job pipeline row graph', async () => {
    // Pre-cleanup in case a previous run was interrupted mid-test.
    await prisma.user.deleteMany({ where: { email: 'db-test@example.com' } });

    const user = await prisma.user.create({
      data: { email: 'db-test@example.com', fullName: 'DB Test' },
    });

    const source = await prisma.jobSource.upsert({
      where: { id: 'jobvision' },
      create: { id: 'jobvision', name: 'JobVision' },
      update: {},
    });

    const job = await prisma.job.create({
      data: {
        logicalKey: 'dbtest-logical-1',
        title: 'Backend Developer',
        company: 'DB Test Co',
        description: 'Node.js TypeScript',
        contentHash: 'dbtest-hash-1',
        sourceId: source.id,
        externalId: 'db-1',
        canonicalUrl: 'https://jobvision.ir/jobs/db-1',
      },
    });

    const listing = await prisma.jobSourceListing.create({
      data: {
        jobId: job.id,
        sourceId: source.id,
        externalId: 'db-1',
        url: 'https://jobvision.ir/jobs/db-1',
      },
    });

    const searchProfile = await prisma.searchProfile.create({
      data: {
        userId: user.id,
        name: 'Backend',
        targetTitles: ['Backend Developer'],
        requiredKeywords: ['Node.js'],
        preferredKeywords: [],
        excludedKeywords: [],
        locations: [],
        employmentTypes: [],
        remotePolicies: [],
      },
    });

    const candidate = await prisma.candidateProfile.create({
      data: {
        userId: user.id,
        profile: { skills: ['node.js'] },
      },
    });

    const match = await prisma.jobMatch.create({
      data: {
        jobId: job.id,
        searchProfileId: searchProfile.id,
        candidateProfileId: candidate.id,
        score: 88,
        recommendation: 'strong_match',
        matchedSkills: ['Node.js'],
        missingSkills: [],
        explanation: 'test',
      },
    });

    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        jobId: job.id,
        jobMatchId: match.id,
        status: 'sent',
        sentAt: new Date(),
      },
    });

    const feedback = await prisma.feedback.create({
      data: { userId: user.id, jobId: job.id, action: 'saved' },
    });

    const run = await prisma.sourceRun.create({
      data: {
        sourceId: source.id,
        searchProfileId: searchProfile.id,
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 100,
        found: 1,
        created: 1,
        status: 'success',
      },
    });

    expect(user.id).toBeTruthy();
    expect(job.id).toBeTruthy();
    expect(listing.id).toBeTruthy();
    expect(match.score).toBe(88);
    expect(notification.status).toBe('sent');
    expect(feedback.id).toBeTruthy();
    expect(run.status).toBe('success');

    // Cleanup (cascades handle children)
    await prisma.sourceRun.delete({ where: { id: run.id } });
    await prisma.feedback.delete({ where: { id: feedback.id } });
    await prisma.notification.delete({ where: { id: notification.id } });
    await prisma.jobMatch.delete({ where: { id: match.id } });
    await prisma.jobSourceListing.delete({ where: { id: listing.id } });
    await prisma.candidateProfile.delete({ where: { id: candidate.id } });
    await prisma.searchProfile.delete({ where: { id: searchProfile.id } });
    await prisma.job.delete({ where: { id: job.id } });
    // jobvision source row is shared reference data — keep it.
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('enforces unique source+externalId', async () => {
    const source = await prisma.jobSource.create({
      data: { id: 'uniq-src', name: 'Uniq' },
    });
    const base = {
      logicalKey: 'uniq-logical',
      title: 't',
      company: 'c',
      description: 'd',
      contentHash: 'uniq-hash',
      sourceId: source.id,
      externalId: 'ext-1',
      canonicalUrl: 'https://x/1',
    };
    await prisma.job.create({ data: base });
    await expect(prisma.job.create({ data: { ...base, logicalKey: 'other' } })).rejects.toThrow();
    await prisma.job.deleteMany({ where: { externalId: 'ext-1' } });
    await prisma.jobSource.delete({ where: { id: source.id } });
  });
});
