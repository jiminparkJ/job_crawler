/**
 * JobVision source adapter.
 *
 * Uses the public candidate API documented in docs/sources/jobvision.md:
 *   POST /api/v1/JobPost/List    — camelCase body (!), numeric sortBy enum
 *   GET  /api/v1/JobPost/Detail?jobPostId=N
 *   GET  /api/v1/JobPost/GetAllSearchFilters
 *
 * No authentication required; no browser automation; no anti-bot bypass.
 */

import type {
  NormalizedJob,
  RawJobResult,
  SearchQuery,
  SourceId,
  SourceListing,
} from '@job-hunter/core';
import type { HttpClient } from '../http.js';

const API_BASE = 'https://candidateapi.jobvision.ir/api/v1';
const SITE_BASE = 'https://jobvision.ir';

/** workType id → EmploymentType (from GetAllSearchFilters, verified 2026-09-02) */
const WORK_TYPE_MAP: Record<number, NormalizedJob['employmentType']> = {
  120: 'full_time',
  121: 'part_time',
  122: 'contract',
};

/** sortBy enum: 0 newest, 1 most relevant, 2 highest salary */
const SORT_NEWEST = 0;

interface JvLocalizedTitle {
  id?: number;
  title?: string | null;
  titleFa?: string | null;
  titleEn?: string | null;
}

interface JvSalary {
  id?: number;
  min?: number | null;
  max?: number | null;
  titleFa?: string | null;
  titleEn?: string | null;
}

interface JvCompany {
  id?: number;
  nameFa?: string | null;
  nameEn?: string | null;
  name?: JvLocalizedTitle | null;
  pageUrl?: string | null;
}

interface JvLocation {
  country?: { titleEn?: string | null } | null;
  province?: { titleEn?: string | null } | null;
  city?: { titleEn?: string | null } | null;
}

interface JvActivationTime {
  date?: string | null;
  beautifyEn?: string | null;
}

interface JvProperties {
  isInternship?: boolean;
  isRemote?: boolean;
  requiredRelatedExperienceYears?: number | null;
  typeId?: number | null;
  salaryCanBeShown?: boolean;
}

export interface JvJobPost {
  id: number;
  title: string;
  isPersian?: boolean;
  properties?: JvProperties;
  company?: JvCompany | null;
  location?: JvLocation | null;
  jobCategories?: JvLocalizedTitle[];
  benefits?: JvLocalizedTitle[];
  workType?: JvLocalizedTitle | null;
  seniorityLevel?: JvLocalizedTitle | null;
  salary?: JvSalary | null;
  industry?: JvLocalizedTitle | null;
  activationTime?: JvActivationTime | null;
  expireTime?: { date?: string | null; isExpired?: boolean } | null;
  // Detail-only fields:
  description?: string | null;
  softwareRequirements?: {
    software?: JvLocalizedTitle | null;
    skill?: JvLocalizedTitle | null;
  }[];
  languageRequirements?: unknown[] | null;
  requiredKnowledge?: string | null;
  isRemote?: boolean;
  isInternship?: boolean;
  requiredRelatedExperienceYears?: number | null;
  typeId?: number | null;
}

interface JvListEnvelope {
  isSuccess: boolean;
  statusCode?: number;
  message?: string | null;
  data?: {
    jobPosts?: JvJobPost[];
    currentPage?: number;
    pageSize?: number;
    jobPostCount?: number;
  } | null;
}

interface JvDetailEnvelope {
  isSuccess: boolean;
  statusCode?: number;
  message?: string | null;
  data?: JvJobPost | null;
}

export interface JobVisionSourceOptions {
  pageSize?: number;
  maxPages?: number;
  timeoutMs?: number;
  baseUrl?: string;
  siteUrl?: string;
}

export class JobVisionSource {
  readonly id: SourceId = 'jobvision';

  private readonly http: HttpClient;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly siteUrl: string;
  private readonly baseUrl: string;

  constructor(http: HttpClient, options: JobVisionSourceOptions = {}) {
    this.http = http;
    this.pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
    this.maxPages = options.maxPages ?? 5;
    this.baseUrl = options.baseUrl ?? API_BASE;
    this.siteUrl = options.siteUrl ?? SITE_BASE;
  }

  /** Search job posts. Returns listings for every discovered job. */
  async search(query: SearchQuery): Promise<SourceListing[]> {
    const listings: SourceListing[] = [];
    const rows = await this.searchRows(query);
    for (const post of rows) {
      if (post?.id == null) continue;
      listings.push({
        source: this.id,
        externalId: String(post.id),
        url: this.jobUrl(String(post.id)),
        fetchedAt: new Date(),
      });
    }
    return listings;
  }

  /** Search job posts, returning raw rows (used to merge list+detail data). */
  async searchRows(query: SearchQuery): Promise<JvJobPost[]> {
    const rows: JvJobPost[] = [];
    const maxPages = query.page ? 1 : this.maxPages;
    const startPage = query.page ?? 1;

    for (let page = startPage; page < startPage + maxPages; page++) {
      const envelope = await this.http.requestJson<JvListEnvelope>('/JobPost/List', {
        method: 'POST',
        body: this.buildListBody(query, page),
      });

      if (!envelope?.isSuccess) {
        throw new Error(`JobVision list failed: ${envelope?.message ?? 'unknown business error'}`);
      }

      const posts = envelope.data?.jobPosts ?? [];
      rows.push(...posts.filter((p: JvJobPost | undefined): p is JvJobPost => p != null));

      const total = envelope.data?.jobPostCount ?? 0;
      if (posts.length === 0 || rows.length >= total) break;
    }

    return rows;
  }

  /** Fetch the raw detail payload for one job. */
  async fetchJob(externalId: string): Promise<RawJobResult> {
    const envelope = await this.http.requestJson<JvDetailEnvelope>(
      `/JobPost/Detail?jobPostId=${encodeURIComponent(externalId)}`,
    );
    if (!envelope?.isSuccess || !envelope.data) {
      throw new Error(
        `JobVision detail failed for ${externalId}: ${envelope?.message ?? 'not found'}`,
      );
    }
    return {
      externalId,
      url: this.jobUrl(externalId),
      data: envelope.data,
    };
  }

  /** Also allows normalizing a list row directly (avoids an extra request). */
  normalizeFromListRow(row: JvJobPost): NormalizedJob {
    return this.normalize(row);
  }

  /** Convert a raw JobVision payload (list row or detail) into a NormalizedJob. */
  normalize(raw: JvJobPost, fallback?: Partial<NormalizedJob>): NormalizedJob {
    const id = String(raw.id);
    const company =
      raw.company?.nameFa ??
      raw.company?.name?.titleFa ??
      raw.company?.nameEn ??
      raw.company?.name?.titleEn ??
      fallback?.company ??
      'Unknown company';

    const workTypeId = raw.workType?.id;
    let employmentType: NormalizedJob['employmentType'] | null = null;
    if (raw.properties?.isInternship ?? raw.isInternship) {
      employmentType = 'internship';
    } else if (workTypeId != null && WORK_TYPE_MAP[workTypeId]) {
      employmentType = WORK_TYPE_MAP[workTypeId];
    } else if (raw.typeId != null && raw.typeId > 1 && WORK_TYPE_MAP[raw.typeId]) {
      employmentType = WORK_TYPE_MAP[raw.typeId];
    }

    const isRemote = raw.properties?.isRemote ?? raw.isRemote ?? null;
    const remote = isRemote == null ? null : isRemote ? ('remote' as const) : null;

    const location = this.formatLocation(raw.location) ?? fallback?.location ?? null;
    const description = stripHtml(raw.description ?? '') || (fallback?.description ?? '');

    const postedAt = raw.activationTime?.date ? new Date(raw.activationTime.date) : null;

    const skills = (raw.softwareRequirements ?? [])
      .map((req) => req?.software?.titleEn ?? req?.software?.titleFa ?? null)
      .filter((s): s is string => Boolean(s))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // JobVision salaries arrive in millions of TOMANS (e.g. min: 40, max: 60
    // meaning 40–60 million Tomans). Normalize to RIALS (IRR, official ISO
    // code, 1 Toman = 10 Rials) so every source stores one unit.
    const salaryToRials = (v: number | null | undefined): number | null =>
      v == null ? null : Math.round(v * 1_000_000 * 10);

    const salaryMinRials = salaryToRials(raw.salary?.min);
    const salaryMaxRials = salaryToRials(raw.salary?.max);

    return {
      id: `jobvision:${id}`,
      source: this.id,
      externalId: id,
      title: (raw.title ?? fallback?.title ?? '').trim() || 'Untitled position',
      company,
      description,
      location,
      remote,
      employmentType,
      salaryMin: salaryMinRials,
      salaryMax: salaryMaxRials,
      salaryCurrency: salaryMinRials != null || salaryMaxRials != null ? 'IRR' : null,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
      url: this.jobUrl(id),
      skills,
    };
  }

  /** Merge list row + detail into one normalized job (best of both). */
  normalizeWithDetail(listRow: JvJobPost, detail: JvJobPost): NormalizedJob {
    const fromList = this.normalize(listRow);
    const fromDetail = this.normalize(detail);
    const detailSkills = fromDetail.skills ?? [];
    const listSkills = fromList.skills ?? [];
    return {
      ...fromList,
      description: fromDetail.description || fromList.description,
      company: fromDetail.company !== 'Unknown company' ? fromDetail.company : fromList.company,
      skills: detailSkills.length > 0 ? detailSkills : listSkills,
      employmentType: fromList.employmentType ?? fromDetail.employmentType,
      remote: fromList.remote ?? fromDetail.remote,
      // Salary may come from either side; both are already Rials.
      salaryMin: fromList.salaryMin ?? fromDetail.salaryMin,
      salaryMax: fromList.salaryMax ?? fromDetail.salaryMax,
      salaryCurrency: fromList.salaryCurrency ?? fromDetail.salaryCurrency,
      postedAt: fromList.postedAt ?? fromDetail.postedAt,
    };
  }

  jobUrl(externalId: string): string {
    return `${this.siteUrl}/jobs/${externalId}`;
  }

  private buildListBody(query: SearchQuery, page: number): Record<string, unknown> {
    const body: Record<string, unknown> = {
      // NOTE: camelCase keys are required — PascalCase silently ignores filters.
      keyword: query.keywords?.join(' ') ?? '',
      requestedPage: page,
      pageSize: this.pageSize,
      sortBy: SORT_NEWEST,
    };
    if (query.locations?.length) {
      // Location filtering via API body is unreliable (documented); we fetch
      // broadly and filter client-side after normalization.
      void query.locations;
    }
    return body;
  }

  private formatLocation(loc?: JvLocation | null): string | null {
    if (!loc) return null;
    const city = loc.city?.titleEn?.trim();
    const province = loc.province?.titleEn?.trim();
    if (city && province && city !== province) return `${city}, ${province}`;
    return city || province || null;
  }
}

/** Strip HTML tags and collapse whitespace (descriptions arrive as HTML). */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
