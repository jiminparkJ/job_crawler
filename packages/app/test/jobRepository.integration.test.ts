import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { JobRepository } from '../src/repositories/jobRepository.js';
import type { NormalizedJob } from '@job-hunter/core';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 'jobvision:1',
    source: 'jobvision',
    externalId: '1',
    title: 'Backend Developer',
    company: 'Example Co',
    description: 'Node.js and TypeScript position with PostgreSQL.',
    location: 'Tehran',
    remote: null,
    employmentType: 'full_time',
    salaryMin: 40,
    salaryMax: 60,
    salaryCurrency: 'IRT',
    postedAt: new Date('2026-09-01T00:00:00Z'),
    url: 'https://jobvision.ir/jobs/1',
    skills: ['Node.js', 'TypeScript'],
    ...overrides,
  };
}

d('JobRepository deduplication', () => {
  let prisma: PrismaClient;
  let repo: JobRepository;
  const createdIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    repo = new JobRepository(prisma);
    // Pre-cleanup: make the suite restart-safe against leftover rows.
    // (JobSource rows are shared reference data and are intentionally kept.)
    await prisma.job.deleteMany({ where: { sourceId: { in: ['jobvision', 'irantalent'] } } });
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.job.deleteMany({ where: { id } }).catch(() => null);
    }
    await prisma.$disconnect();
  });

  it('creates a new job with its source listing', async () => {
    const r = await repo.upsertJob(makeJob());
    createdIds.push(r.jobId);
    expect(r.change).toBe('created');
    const listings = await prisma.jobSourceListing.findMany({
      where: { jobId: r.jobId },
    });
    expect(listings).toHaveLength(1);
    expect(listings[0].url).toContain('jobvision.ir/jobs/1');
  });

  it('returns duplicate for identical re-insert (idempotency)', async () => {
    const r = await repo.upsertJob(makeJob());
    expect(r.change).toBe('duplicate');
    expect(r.jobId).toBe(createdIds[0]);
  });

  it('returns updated when content changes', async () => {
    const r = await repo.upsertJob(
      makeJob({ description: 'Node.js and TypeScript position with PostgreSQL and Docker.' }),
    );
    expect(r.change).toBe('updated');
    expect(r.jobId).toBe(createdIds[0]);
  });

  it('dedupes by canonical URL (tracking params stripped)', async () => {
    const r = await repo.upsertJob(
      makeJob({ externalId: '1b', url: 'https://jobvision.ir/jobs/1?utm_source=x#top' }),
    );
    expect(r.change).toBe('duplicate');
    expect(r.jobId).toBe(createdIds[0]);
  });

  it('same job posted on another source is cross_source_duplicate (same logical job)', async () => {
    const r = await repo.upsertJob(
      makeJob({
        id: 'irantalent:9',
        source: 'irantalent',
        externalId: '9',
        url: 'https://irantalent.com/jobs/9',
      }),
    );
    expect(r.change).toBe('cross_source_duplicate');
    expect(r.jobId).toBe(createdIds[0]);
    // Both original listings retained
    const listings = await prisma.jobSourceListing.findMany({
      where: { jobId: createdIds[0] },
    });
    expect(listings).toHaveLength(3); // original, dup-url variant, irantalent
    expect(listings.some((l) => l.url.includes('irantalent.com'))).toBe(true);
  });

  it('dedupes by content hash when title/company differ slightly', async () => {
    const r = await repo.upsertJob(
      makeJob({
        id: 'jobvision:2',
        externalId: '2',
        title: 'Backend Developer ', // trailing space → different logical key
        url: 'https://jobvision.ir/jobs/2',
      }),
    );
    // normalizeForHash sorts tokens; trailing space + identical rest ⇒ same hash
    expect(r.change).toBe('cross_source_duplicate');
    expect(r.jobId).toBe(createdIds[0]);
  });

  it('persists a different logical job normally', async () => {
    const r = await repo.upsertJob(
      makeJob({
        id: 'jobvision:3',
        externalId: '3',
        title: 'Frontend Developer',
        company: 'Other Co',
        description: 'React and CSS work.',
        url: 'https://jobvision.ir/jobs/3',
        skills: ['React'],
      }),
    );
    createdIds.push(r.jobId);
    expect(r.change).toBe('created');
    expect(r.jobId).not.toBe(createdIds[0]);
  });

  it('records source runs with duration and counters', async () => {
    const startedAt = new Date();
    const runId = await repo.recordSourceRun({
      sourceId: 'jobvision',
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 1500),
      found: 10,
      created: 5,
      duplicates: 5,
      errors: 1,
      errorDetails: ['job 999: HTTP 404'],
      status: 'partial',
    });
    const run = await prisma.sourceRun.findUnique({ where: { id: runId } });
    expect(run?.durationMs).toBeGreaterThanOrEqual(1500);
    expect(run?.found).toBe(10);
    expect(run?.status).toBe('partial');
    await prisma.sourceRun.delete({ where: { id: runId } });
  });
});
