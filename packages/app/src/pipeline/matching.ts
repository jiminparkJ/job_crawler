/**
 * Match pipeline stage: collected jobs × active SearchProfiles →
 * MatchingEngine → persisted JobMatch rows (PROMPT M5).
 *
 * Idempotent: (jobId, searchProfileId) is unique; re-running a job updates
 * its score instead of duplicating. Rejected-by-hard-filter results are
 * persisted as status 'rejected' for observability but never notified.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  MatchingEngine,
  type CandidateProfile,
  type JobMatchResult,
  type SearchProfile as CoreSearchProfile,
} from '@job-hunter/core';

export interface MatchRunStats {
  jobsConsidered: number;
  profilesConsidered: number;
  matchesCreated: number;
  matchesUpdated: number;
  matchesPassed: number;
  matchesRejected: number;
}

/** DB SearchProfile row → core SearchProfile shape for the engine. */
export function toCoreSearchProfile(row: {
  id: string;
  targetTitles: string[];
  requiredKeywords: string[];
  preferredKeywords: string[];
  excludedKeywords: string[];
  locations: string[];
  employmentTypes: string[];
  remotePolicies: string[];
  minimumYearsExp: number | null;
  minimumMatchScore: number;
  minSalary: number | null;
  salaryCurrency: string | null;
}): CoreSearchProfile {
  return {
    id: row.id,
    userId: '',
    name: '',
    targetTitles: row.targetTitles,
    requiredKeywords: row.requiredKeywords,
    preferredKeywords: row.preferredKeywords,
    excludedKeywords: row.excludedKeywords,
    locations: row.locations,
    employmentTypes: row.employmentTypes as CoreSearchProfile['employmentTypes'],
    remotePolicies: row.remotePolicies as CoreSearchProfile['remotePolicies'],
    minimumYearsExperience: row.minimumYearsExp,
    minimumMatchScore: row.minimumMatchScore,
    minSalary: row.minSalary,
    salaryCurrency: row.salaryCurrency,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export class MatchService {
  private readonly engine: MatchingEngine;

  constructor(
    private readonly prisma: PrismaClient,
    engine?: MatchingEngine,
  ) {
    this.engine = engine ?? new MatchingEngine();
  }

  /**
   * Match all active jobs (or a subset by id) against all active search
   * profiles. The candidate profile (optional) enriches skill matching.
   */
  async runMatching(
    opts: {
      jobIds?: string[];
      userId?: string;
      candidate?: CandidateProfile | null;
    } = {},
  ): Promise<MatchRunStats> {
    const stats: MatchRunStats = {
      jobsConsidered: 0,
      profilesConsidered: 0,
      matchesCreated: 0,
      matchesUpdated: 0,
      matchesPassed: 0,
      matchesRejected: 0,
    };

    const profiles = await this.prisma.searchProfile.findMany({
      where: {
        active: true,
        ...(opts.userId ? { userId: opts.userId } : {}),
      },
    });
    stats.profilesConsidered = profiles.length;
    if (profiles.length === 0) return stats;

    const jobs = await this.prisma.job.findMany({
      where: { active: true, ...(opts.jobIds ? { id: { in: opts.jobIds } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    stats.jobsConsidered = jobs.length;

    for (const jobRow of jobs) {
      const job = this.rowToNormalizedJob(jobRow);
      for (const profileRow of profiles) {
        const profile = toCoreSearchProfile(profileRow);
        const result = this.engine.evaluate(job, profile, opts.candidate ?? undefined);
        const passed =
          result.recommendation !== 'no_match' &&
          result.breakdown.finalScore >= profile.minimumMatchScore;

        const data = {
          jobId: jobRow.id,
          searchProfileId: profileRow.id,
          score: result.breakdown.finalScore,
          recommendation: result.recommendation,
          matchedSkills: result.matchedSkills,
          missingSkills: result.missingSkills,
          explanation: result.explanation,
          aiAnalysis: (result.aiAnalysis ?? Prisma.DbNull) as unknown as Prisma.InputJsonValue,
          status: passed ? 'new' : 'rejected',
        };

        const existing = await this.prisma.jobMatch.findUnique({
          where: { jobId_searchProfileId: { jobId: jobRow.id, searchProfileId: profileRow.id } },
          select: { id: true, status: true },
        });

        if (existing) {
          // Preserve user feedback statuses; only refresh scores/labels.
          const keepStatus = existing.status !== 'new' && existing.status !== 'rejected';
          await this.prisma.jobMatch.update({
            where: { id: existing.id },
            data: keepStatus ? { ...data, status: existing.status } : data,
          });
          stats.matchesUpdated++;
        } else {
          await this.prisma.jobMatch.create({
            data: {
              ...data,
              candidateProfileId: await this.profileIdFor(profileRow.userId),
            },
          });
          stats.matchesCreated++;
        }

        if (passed) stats.matchesPassed++;
        else stats.matchesRejected++;
      }
    }

    return stats;
  }

  /** Matches ready for notification: status 'new' and score ≥ threshold. */
  async pendingNotificationMatches(limit = 50): Promise<
    { id: string; jobId: string; score: number }[]
  > {
    return this.prisma.jobMatch.findMany({
      where: { status: 'new' },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true, jobId: true, score: true },
    });
  }

  private async profileIdFor(userId: string): Promise<string> {
    const existing = await this.prisma.candidateProfile.findFirst({
      where: { userId },
      orderBy: { extractedAt: 'desc' },
      select: { id: true },
    });
    if (existing) return existing.id;
    // JobMatch requires a CandidateProfile FK; create a stub for this user.
    const stub = await this.prisma.candidateProfile.create({
      data: { userId, profile: { note: 'stub profile created by matcher' } },
    });
    return stub.id;
  }

  private rowToNormalizedJob(row: {
    id: string;
    sourceId: string;
    externalId: string;
    title: string;
    company: string;
    description: string;
    location: string | null;
    remote: string | null;
    employmentType: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    postedAt: Date | null;
    canonicalUrl: string;
  }) {
    return {
      id: row.id,
      source: row.sourceId as 'jobvision' | 'irantalent' | 'linkedin',
      externalId: row.externalId,
      title: row.title,
      company: row.company,
      description: row.description,
      location: row.location,
      remote: (row.remote as 'remote' | 'hybrid' | 'onsite' | null) ?? null,
      employmentType: row.employmentType as never,
      salaryMin: row.salaryMin,
      salaryMax: row.salaryMax,
      salaryCurrency: row.salaryCurrency,
      postedAt: row.postedAt,
      url: row.canonicalUrl,
      skills: [],
    };
  }
}

export type { JobMatchResult };
