/**
 * Worker startup: Prisma lifecycle, stale-run recovery, scheduler wiring.
 * Used by the server entrypoint; exported separately for tests.
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { Scheduler } from './scheduler.js';
import { createWorkerTick } from './worker.js';

export interface WorkerStartupOptions {
  intervalMinutes: number;
  jobvisionEnabled: boolean;
  irantalentEnabled: boolean;
  keywords?: string[];
  pageSize?: number;
  maxPages?: number;
  irantalentCategories?: string[];
  logger?: Logger;
  prisma?: PrismaClient;
}

export interface RunningWorker {
  prisma: PrismaClient;
  scheduler: Scheduler;
  stop: () => Promise<void>;
}

/** Close SourceRuns left 'running' by a crashed previous process. */
export async function recoverStaleSourceRuns(
  prisma: PrismaClient,
  opts: { now?: Date; maxAgeMinutes?: number } = {},
): Promise<number> {
  const running = await prisma.sourceRun.findMany({
    where: { status: 'running' },
    select: { id: true, startedAt: true, status: true },
  });
  const stale = running.filter((r) => {
    const now = opts.now ?? new Date();
    const maxAgeMs = (opts.maxAgeMinutes ?? 60) * 60_000;
    return now.getTime() - r.startedAt.getTime() > maxAgeMs;
  });
  await prisma.sourceRun.updateMany({
    where: { id: { in: stale.map((r) => r.id) } },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      errorDetails: ['closed: stale run recovered at startup'],
    },
  });
  return stale.length;
}

export async function startWorker(options: WorkerStartupOptions): Promise<RunningWorker> {
  const prisma = options.prisma ?? new PrismaClient();

  const recovered = await recoverStaleSourceRuns(prisma);
  if (recovered > 0) {
    options.logger?.info({ recovered }, 'closed stale source runs from previous process');
  }

  const tick = createWorkerTick(
    prisma,
    {
      jobvisionEnabled: options.jobvisionEnabled,
      irantalentEnabled: options.irantalentEnabled,
      keywords: options.keywords ?? ['node.js', 'backend', 'developer'],
      pageSize: options.pageSize ?? 20,
      maxPages: options.maxPages ?? 3,
      irantalentCategories: options.irantalentCategories,
    },
    options.logger,
  );

  const scheduler = new Scheduler({
    intervalMinutes: options.intervalMinutes,
    tick,
    jitterMs: 5_000,
    logger: options.logger,
  });
  scheduler.start();

  return {
    prisma,
    scheduler,
    stop: async () => {
      scheduler.stop();
      if (!options.prisma) await prisma.$disconnect(); // only if we own it
    },
  };
}
