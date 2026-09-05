/**
 * Worker orchestration: builds configured sources and runs the full
 * collection pipeline per tick. The scheduler drives this; each tick is
 * failure-isolated (sources run concurrently, one crashing source never
 * stops the others).
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { JobRepository } from '../repositories/jobRepository.js';
import { UndiciHttpClient } from '../sources/http.js';
import { JobVisionSource } from '../sources/jobvision/jobvisionSource.js';
import { IranTalentSource } from '../sources/irantalent/irantalentSource.js';
import { runAllCollections, type PipelineResult } from './collection.js';

export interface WorkerTickingOptions {
  jobvisionEnabled: boolean;
  irantalentEnabled: boolean;
  keywords: string[];
  pageSize: number;
  maxPages: number;
  irantalentCategories?: string[];
}

/** Default worker tick options — every value overridable from config. */
export const DEFAULT_WORKER_OPTIONS: WorkerTickingOptions = {
  jobvisionEnabled: true,
  irantalentEnabled: true,
  keywords: ['node.js', 'backend', 'developer'],
  pageSize: 20,
  maxPages: 3,
};

export function buildPipelineResultSummary(results: PipelineResult[]): {
  status: 'success' | 'partial' | 'failed';
  totalFound: number;
  totalCreated: number;
  errors: number;
} {
  const totalFound = results.reduce((a, r) => a + r.found, 0);
  const totalCreated = results.reduce((a, r) => a + r.created, 0);
  const errors = results.reduce((a, r) => a + r.errors, 0);
  const failed = results.some((r) => r.status === 'failed');
  const partial = results.some((r) => r.status === 'partial');
  return {
    status: failed ? 'failed' : partial ? 'partial' : 'success',
    totalFound,
    totalCreated,
    errors,
  };
}

/**
 * Create the worker tick: collects from all enabled sources.
 * Accepts an existing PrismaClient (server-managed lifecycle) so tests and
 * the server share one client.
 */
export function createWorkerTick(
  prisma: PrismaClient,
  options: WorkerTickingOptions = DEFAULT_WORKER_OPTIONS,
  logger?: Logger,
): () => Promise<PipelineResult[]> {
  const repo = new JobRepository(prisma);

  return async () => {
    const jvHttp = new UndiciHttpClient({
      baseUrl: 'https://candidateapi.jobvision.ir/api/v1',
    });
    const itHttp = new UndiciHttpClient({ baseUrl: 'https://www.irantalent.com' });

    const runners: { run: () => Promise<PipelineResult> }[] = [];
    if (options.jobvisionEnabled) {
      const source = new JobVisionSource(jvHttp, {
        pageSize: options.pageSize,
        maxPages: options.maxPages,
      });
      runners.push({
        run: () => runJobVisionCollectionSafe(source, repo, options, logger),
      });
    }
    if (options.irantalentEnabled) {
      const source = new IranTalentSource(itHttp, {
        ...(options.irantalentCategories ? { categorySlugs: options.irantalentCategories } : {}),
      });
      runners.push({
        run: () => runIranTalentCollectionSafe(source, repo, logger),
      });
    }

    return runAllCollections(runners, logger);
  };
}

// Local wrappers keep collection.ts import surface unchanged while making
// each runner reject-safe (source isolation already handled by runAllCollections).
async function runJobVisionCollectionSafe(
  source: JobVisionSource,
  repo: JobRepository,
  options: WorkerTickingOptions,
  logger?: Logger,
) {
  const { runJobVisionCollection } = await import('./collection.js');
  return runJobVisionCollection(source, repo, { keywords: options.keywords }, logger);
}

async function runIranTalentCollectionSafe(
  source: IranTalentSource,
  repo: JobRepository,
  logger?: Logger,
) {
  const { runIranTalentCollection } = await import('./collection.js');
  return runIranTalentCollection(source, repo, {}, logger);
}
