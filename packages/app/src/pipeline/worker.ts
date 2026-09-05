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
  /** Run matching + notification stages after collection (default true). */
  matchAndNotify?: boolean;
  /** Telegram credentials for the notification stage. */
  telegram?: {
    botToken: string;
    chatId: string;
  };
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

    const collectionResults = await runAllCollections(runners, logger);

    // Full pipeline per tick: collect → match → (personalize) → notify.
    if (options.matchAndNotify !== false) {
      try {
        const { MatchService } = await import('./matching.js');
        const { PersonalizationEngine } = await import('../personalization/engine.js');
        const { NotificationService } = await import('../telegram/notificationService.js');
        const { TelegramBotClient } = await import('../telegram/client.js');
        const { CandidateProfileService } = await import('../resume/candidateProfileService.js');

        const matcher = new MatchService(prisma);
        const resume = new CandidateProfileService(prisma);

        // Match per user that owns an active search profile.
        const users = await prisma.user.findMany({
          where: { searchProfiles: { some: { active: true } } },
          select: { id: true },
        });
        for (const u of users) {
          const candidate = await resume.getProfile(u.id);
          await matcher.runMatching({ userId: u.id, candidate });
          const pers = new PersonalizationEngine(prisma);
          await pers.rerank(u.id);
        }

        // Notify (only when Telegram is configured).
        if (options.telegram?.botToken && options.telegram.chatId) {
          const telegram = new TelegramBotClient(
            new UndiciHttpClient({ baseUrl: 'https://api.telegram.org' }),
            options.telegram.botToken,
          );
          const notifier = new NotificationService({
            prisma,
            telegram,
            chatId: options.telegram.chatId,
            logger,
          });
          const notifyStats = await notifier.notifyPendingMatches(20);
          logger?.info({ ...notifyStats }, 'notifications sent');
        }
      } catch (err) {
        // Match/notify failures never break collection reporting.
        logger?.error(
          { err: err instanceof Error ? err.message : String(err) },
          'match/notify stage failed',
        );
      }
    }

    return collectionResults;
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
