import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { recoverStaleSourceRuns, startWorker } from '../src/pipeline/startWorker.js';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

d('worker startup', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('closes stale running SourceRuns at startup', async () => {
    await prisma.sourceRun.deleteMany({ where: { sourceId: 'stale-test-src' } });
    await prisma.jobSource
      .create({
        data: { id: 'stale-test-src', name: 'Stale Test' },
      })
      .catch(() => {});
    await prisma.sourceRun.create({
      data: {
        sourceId: 'stale-test-src',
        startedAt: new Date(Date.now() - 3 * 60 * 60_000), // 3h old
        status: 'running',
      },
    });
    await prisma.sourceRun.create({
      data: {
        sourceId: 'stale-test-src',
        startedAt: new Date(Date.now() - 5 * 60_000), // 5min old — fresh
        status: 'running',
      },
    });

    const closed = await recoverStaleSourceRuns(prisma);
    expect(closed).toBe(1);

    const statuses = await prisma.sourceRun.findMany({
      where: { sourceId: 'stale-test-src' },
      select: { status: true },
      orderBy: { startedAt: 'asc' },
    });
    expect(statuses[0].status).toBe('failed'); // stale one closed
    expect(statuses[1].status).toBe('running'); // fresh one untouched

    await prisma.sourceRun.deleteMany({ where: { sourceId: 'stale-test-src' } });
    await prisma.jobSource.delete({ where: { id: 'stale-test-src' } }).catch(() => null);
  });

  it('startWorker wires scheduler with disabled sources (no-op tick), stop cleanly', async () => {
    const worker = await startWorker({
      intervalMinutes: 5,
      jobvisionEnabled: false,
      irantalentEnabled: false,
    });

    expect(worker.scheduler).toBeDefined();
    worker.scheduler.stop();
    await worker.stop();
    // no collections ran since all sources disabled; no throw = pass
  });
});
