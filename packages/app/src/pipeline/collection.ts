/**
 * Job collection pipeline with source isolation:
 * one failing source never stops the others; every run is recorded in
 * SourceRun; per-job detail failures are tolerated and counted.
 */

import type { Logger } from 'pino';
import type { NormalizedJob, SearchQuery, SourceId, SourceListing } from '@job-hunter/core';
import type { JobVisionSource, JvJobPost } from '../sources/jobvision/jobvisionSource.js';
import { JobRepository, type JobChange } from '../repositories/jobRepository.js';

export interface SourceRunner {
  readonly id: SourceId;
  collect(query: SearchQuery): Promise<{ listings: SourceListing[]; normalized: NormalizedJob[] }>;
}

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

/** Runs one JobVision search→fetch→normalize→persist pass. */
export async function runJobVisionCollection(
  source: JobVisionSource,
  repo: JobRepository,
  query: SearchQuery,
  logger?: Logger,
): Promise<PipelineResult> {
  const startedAt = new Date();
  const errorDetails: string[] = [];
  const counters = { created: 0, updated: 0, duplicates: 0 };

  const listings: SourceListing[] = [];
  const rowById = new Map<string, JvJobPost>();
  try {
    // One search returns raw rows; derive listings from them (single request).
    const rows = await source.searchRows(query);
    for (const row of rows) {
      if (row?.id == null) continue;
      const externalId = String(row.id);
      rowById.set(externalId, row);
      listings.push({
        source: 'jobvision',
        externalId,
        url: source.jobUrl(externalId),
        fetchedAt: new Date(),
      });
    }
  } catch (err) {
    const message = `search failed: ${err instanceof Error ? err.message : String(err)}`;
    errorDetails.push(message);
    logger?.warn({ source: 'jobvision', err: message }, 'collection search failed');
    await repo.recordSourceRun({
      sourceId: 'jobvision',
      startedAt,
      finishedAt: new Date(),
      errors: 1,
      errorDetails,
      status: 'failed',
    });
    return {
      sourceId: 'jobvision',
      status: 'failed',
      found: 0,
      ...counters,
      errors: 1,
      errorDetails,
      durationMs: Date.now() - startedAt.getTime(),
    };
  }

  // Search succeeded; tolerate per-job failures. List rows are already
  // collected in rowById (structural fields like workType/salary survive the
  // detail merge).
  for (const listing of listings) {
    try {
      const detail = await source.fetchJob(listing.externalId);
      const detailRow = detail.data as JvJobPost;
      const listRow = rowById.get(listing.externalId);
      const job = listRow
        ? source.normalizeWithDetail(listRow, detailRow)
        : source.normalize(detailRow);
      const result = await repo.upsertJob(job);
      const bucket: JobChange = result.change;
      if (bucket === 'created') counters.created++;
      else if (bucket === 'updated') counters.updated++;
      else counters.duplicates++;
    } catch (err) {
      const message = `job ${listing.externalId}: ${err instanceof Error ? err.message : String(err)}`;
      errorDetails.push(message);
      logger?.debug({ source: 'jobvision', err: message }, 'job fetch failed');
    }
  }

  const status = errorDetails.length > 0 ? 'partial' : 'success';
  const finishedAt = new Date();
  await repo.recordSourceRun({
    sourceId: 'jobvision',
    startedAt,
    finishedAt,
    found: listings.length,
    created: counters.created,
    updated: counters.updated,
    duplicates: counters.duplicates,
    errors: errorDetails.length,
    errorDetails,
    status,
  });
  logger?.info(
    { source: 'jobvision', found: listings.length, ...counters, errors: errorDetails.length },
    'collection finished',
  );

  return {
    sourceId: 'jobvision',
    status,
    found: listings.length,
    ...counters,
    errors: errorDetails.length,
    errorDetails,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

/** Runs all enabled collections; never rejects (source isolation). */
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
          sourceId: 'unknown' as SourceId,
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
