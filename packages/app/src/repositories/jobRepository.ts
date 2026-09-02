/**
 * Job persistence with multi-level deduplication (PROMPT §12):
 *   1. source + externalId (unique constraint)
 *   2. canonical URL
 *   3. logical key (title+company+location)
 *   4. content hash
 *
 * Every original source listing is retained (JobSourceListing), even when the
 * logical job already exists from another source.
 */

import { PrismaClient } from '@prisma/client';
import { canonicalUrl, contentHash, logicalKey, type NormalizedJob } from '@job-hunter/core';

export type JobChange = 'created' | 'updated' | 'duplicate' | 'cross_source_duplicate';

export interface UpsertJobResult {
  jobId: string;
  change: JobChange;
}

export class JobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Persist a normalized job. Idempotent: re-running with the same job
   * yields `duplicate` without touching data. Cross-source duplicates
   * keep their own Job row but preserve every listing URL.
   */
  async upsertJob(job: NormalizedJob): Promise<UpsertJobResult> {
    const url = canonicalUrl(job.source, job.url);
    const hash = contentHash(job);
    const key = logicalKey(job);

    return this.prisma.$transaction(async (tx) => {
      // Source row must exist for FK on listings in every path below.
      const ensureSource = () =>
        tx.jobSource.upsert({
          where: { id: job.source },
          create: { id: job.source, name: job.source },
          update: {},
        });

      // Level 1: same source + external id ⇒ update or no-op.
      const existingById = await tx.job.findUnique({
        where: { sourceId_externalId: { sourceId: job.source, externalId: job.externalId } },
      });
      if (existingById) {
        const listingExists = await tx.jobSourceListing.findUnique({
          where: {
            sourceId_externalId: { sourceId: job.source, externalId: job.externalId },
          },
        });
        if (!listingExists) {
          await tx.jobSourceListing.create({
            data: {
              jobId: existingById.id,
              sourceId: job.source,
              externalId: job.externalId,
              url,
            },
          });
        }
        if (existingById.contentHash === hash)
          return { jobId: existingById.id, change: 'duplicate' };
        await tx.job.update({
          where: { id: existingById.id },
          data: {
            title: job.title,
            company: job.company,
            description: job.description,
            location: job.location ?? undefined,
            remote: job.remote ?? undefined,
            employmentType: job.employmentType ?? undefined,
            salaryMin: job.salaryMin ?? undefined,
            salaryMax: job.salaryMax ?? undefined,
            salaryCurrency: job.salaryCurrency ?? undefined,
            postedAt: job.postedAt ?? undefined,
            contentHash: hash,
            active: true,
          },
        });
        return { jobId: existingById.id, change: 'updated' };
      }

      // Level 2: canonical URL match (same source, different external id form).
      const existingByUrl = await tx.job.findFirst({
        where: { sourceId: job.source, canonicalUrl: url },
      });
      if (existingByUrl) {
        await ensureSource();
        await tx.jobSourceListing
          .create({
            data: {
              jobId: existingByUrl.id,
              sourceId: job.source,
              externalId: job.externalId,
              url,
            },
          })
          .catch(() => null); // unique race: listing already present
        return { jobId: existingByUrl.id, change: 'duplicate' };
      }

      // Level 3: logical job dedup across sources.
      const existingLogical = await tx.job.findUnique({ where: { logicalKey: key } });
      if (existingLogical) {
        await ensureSource();
        await tx.jobSourceListing
          .create({
            data: {
              jobId: existingLogical.id,
              sourceId: job.source,
              externalId: job.externalId,
              url,
            },
          })
          .catch(() => null);
        return { jobId: existingLogical.id, change: 'cross_source_duplicate' };
      }

      // Level 4 safety net: content-hash match (near-identical text).
      const existingByHash = await tx.job.findFirst({ where: { contentHash: hash } });
      if (existingByHash) {
        await ensureSource();
        await tx.jobSourceListing
          .create({
            data: {
              jobId: existingByHash.id,
              sourceId: job.source,
              externalId: job.externalId,
              url,
            },
          })
          .catch(() => null);
        return { jobId: existingByHash.id, change: 'cross_source_duplicate' };
      }

      // New logical job: create job + listing.
      await ensureSource();

      const created = await tx.job.create({
        data: {
          logicalKey: key,
          title: job.title,
          company: job.company,
          description: job.description,
          location: job.location ?? undefined,
          remote: job.remote ?? undefined,
          employmentType: job.employmentType ?? undefined,
          salaryMin: job.salaryMin ?? undefined,
          salaryMax: job.salaryMax ?? undefined,
          salaryCurrency: job.salaryCurrency ?? undefined,
          postedAt: job.postedAt ?? undefined,
          contentHash: hash,
          sourceId: job.source,
          externalId: job.externalId,
          canonicalUrl: url,
        },
      });

      await tx.jobSourceListing.create({
        data: {
          jobId: created.id,
          sourceId: job.source,
          externalId: job.externalId,
          url,
        },
      });

      return { jobId: created.id, change: 'created' };
    });
  }

  /** Record a source run for health/observability (PROMPT §14). */
  async recordSourceRun(stats: {
    sourceId: string;
    searchProfileId?: string | null;
    startedAt: Date;
    finishedAt?: Date | null;
    found?: number;
    created?: number;
    updated?: number;
    duplicates?: number;
    errors?: number;
    errorDetails?: string[];
    status?: 'success' | 'failed' | 'partial';
  }): Promise<string> {
    const finishedAt = stats.finishedAt ?? new Date();
    const run = await this.prisma.sourceRun.create({
      data: {
        sourceId: stats.sourceId,
        searchProfileId: stats.searchProfileId ?? undefined,
        startedAt: stats.startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - stats.startedAt.getTime(),
        found: stats.found ?? 0,
        created: stats.created ?? 0,
        updated: stats.updated ?? 0,
        duplicates: stats.duplicates ?? 0,
        errors: stats.errors ?? 0,
        errorDetails: stats.errorDetails ?? [],
        status: stats.status ?? 'success',
      },
    });
    return run.id;
  }
}
