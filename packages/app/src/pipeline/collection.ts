/**
 * Job collection pipeline with source isolation:
 * one failing source never stops the others; every run is recorded in
 * SourceRun; per-job failures are tolerated and counted.
 */

import type { Logger } from 'pino';
import type { NormalizedJob, SearchQuery, SourceId } from '@job-hunter/core';
import type { JobVisionSource, JvJobPost } from '../sources/jobvision/jobvisionSource.js';
import type { IranTalentSource, ItPosition } from '../sources/irantalent/irantalentSource.js';
import { JobRepository, type JobChange } from '../repositories/jobRepository.js';

export interface PipelineResult {
  sourceId: SourceId;
  status: 'success' | 'partial' | 'failed';
  found: number;
  created: number;
  updated: number;
  duplicates: number;
  errors: number;
  errorDetails: string[];
  durationMs: number;
}

/** Common result shape used by the per-source collection steps below. */
interface CollectionOutcome {
  listings: { externalId: string }[];
  jobs: NormalizedJob[];
  searchError?: string;
  jobErrors?: string[];
}

/** Shared run-loop: search → per-job normalize/persist with failure isolation. */
async function runCollection(
  sourceId: SourceId,
  repo: JobRepository,
  outcome: CollectionOutcome,
  logger: Logger | undefined,
): Promise<PipelineResult> {
  const startedAt = Date.now();
  const errorDetails: string[] = [];
  const counters = { created: 0, updated: 0, duplicates: 0 };

  if (outcome.searchError) {
    errorDetails.push(outcome.searchError);
    logger?.warn({ source: sourceId, err: outcome.searchError }, 'collection search failed');
    const finishedAt = new Date();
    await repo.recordSourceRun({
      sourceId,
      startedAt: new Date(finishedAt.getTime() - 1),
      finishedAt,
      errors: 1,
      errorDetails,
      status: 'failed',
    });
    return {
      sourceId,
      status: 'failed',
      found: 0,
      ...counters,
      errors: 1,
      errorDetails,
      durationMs: Date.now() - startedAt,
    };
  }

  for (const job of outcome.jobs) {
    try {
      const result = await repo.upsertJob(job);
      const bucket: JobChange = result.change;
      if (bucket === 'created') counters.created++;
      else if (bucket === 'updated') counters.updated++;
      else counters.duplicates++;
    } catch (err) {
      const message = `job ${job.externalId}: ${err instanceof Error ? err.message : String(err)}`;
      errorDetails.push(message);
      logger?.debug({ source: sourceId, err: message }, 'job persist failed');
    }
  }

  const status = errorDetails.length > 0 ? 'partial' : 'success';
  const finishedAt = new Date();
  await repo.recordSourceRun({
    sourceId,
    startedAt: new Date(finishedAt.getTime() - Math.max(1, finishedAt.getTime() - startedAt)),
    finishedAt,
    found: outcome.listings.length,
    created: counters.created,
    updated: counters.updated,
    duplicates: counters.duplicates,
    errors: errorDetails.length,
    errorDetails,
    status,
  });
  logger?.info(
    { source: sourceId, found: outcome.listings.length, ...counters, errors: errorDetails.length },
    'collection finished',
  );

  return {
    sourceId,
    status,
    found: outcome.listings.length,
    ...counters,
    errors: errorDetails.length,
    errorDetails,
    durationMs: finishedAt.getTime() - startedAt,
  };
}

/** Runs one JobVision search→fetch→normalize→persist pass. */
export async function runJobVisionCollection(
  source: JobVisionSource,
  repo: JobRepository,
  query: SearchQuery,
  logger?: Logger,
): Promise<PipelineResult> {
  let outcome: CollectionOutcome;

  try {
    // Single search returns raw rows; list rows carry structural fields
    // (workType, salary) that the detail merge needs.
    const rows = await source.searchRows(query);
    const listings = rows.filter((r) => r?.id != null).map((r) => ({ externalId: String(r.id) }));
    const rowById = new Map<string, JvJobPost>();
    for (const row of rows) {
      if (row?.id != null) rowById.set(String(row.id), row);
    }

    const jobs: NormalizedJob[] = [];
    const jobErrors: string[] = [];
    for (const row of rows) {
      if (row?.id == null) continue;
      try {
        const detail = await source.fetchJob(String(row.id));
        const detailRow = detail.data as JvJobPost;
        jobs.push(source.normalizeWithDetail(row, detailRow));
      } catch (err) {
        jobErrors.push(`job ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Per-job fetch failures surface as partial run (not a search failure).
    outcome = { listings, jobs, searchError: undefined };
    if (jobErrors.length > 0 && jobs.length > 0) {
      // Fold job-level errors in: re-run collection with jobs and a combined
      // error list is awkward; simpler: keep jobs and add errors below.
      outcome.jobErrors = jobErrors;
    }
  } catch (err) {
    outcome = {
      listings: [],
      jobs: [],
      searchError: `search failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = await runCollection('jobvision', repo, outcome, logger);
  // runCollection counted per-job persist failures; merge fetch failures.
  const fetchErrors = outcome.jobErrors ?? [];
  if (fetchErrors.length > 0) {
    result.errors += fetchErrors.length;
    result.errorDetails.push(...fetchErrors);
    result.status = result.status === 'failed' ? 'failed' : 'partial';
  }
  return result;
}

/** Runs one IranTalent search→normalize→persist pass (list rows are complete). */
export async function runIranTalentCollection(
  source: IranTalentSource,
  repo: JobRepository,
  query: SearchQuery,
  logger?: Logger,
): Promise<PipelineResult> {
  let outcome: CollectionOutcome;
  try {
    const rows = await source.searchRows(query);
    const listings = rows.filter((r) => r?.id != null).map((r) => ({ externalId: String(r.id) }));
    const jobs = rows.filter((r) => r?.id != null).map((r) => source.normalize(r as ItPosition));
    outcome = { listings, jobs };
  } catch (err) {
    outcome = {
      listings: [],
      jobs: [],
      searchError: `search failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return runCollection('irantalent', repo, outcome, logger);
}

/**
 * Run all enabled collections concurrently. Never rejects: a crashing
 * runner is reported as a failed result (source isolation, PROMPT §14).
 */
export async function runAllCollections(
  runners: { run: () => Promise<PipelineResult> }[],
  logger?: Logger,
): Promise<PipelineResult[]> {
  const results = await Promise.all(
    runners.map(async (r) => {
      try {
        return await r.run();
      } catch (err) {
        logger?.error({ err }, 'collection runner crashed unexpectedly');
        return {
          sourceId: 'jobvision' as SourceId,
          status: 'failed' as const,
          found: 0,
          created: 0,
          updated: 0,
          duplicates: 0,
          errors: 1,
          errorDetails: [err instanceof Error ? err.message : String(err)],
          durationMs: 0,
        };
      }
    }),
  );
  return results;
}
