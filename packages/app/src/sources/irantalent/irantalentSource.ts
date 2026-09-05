/**
 * IranTalent source adapter.
 *
 * Uses the public SSR pages of www.irantalent.com (Angular Universal):
 * each /en/jobs/{slug}?page=N HTML embeds the full search-result JSON under
 * "serverSideSearchResult" — the site's own public data interface. The direct
 * JSON API (api.irantalent.com) rejects external callers (404); we do not
 * attempt to bypass that. See docs/sources/irantalent.md.
 */

import type {
  NormalizedJob,
  RawJobResult,
  SearchQuery,
  SourceId,
  SourceListing,
} from '@job-hunter/core';
import { stripHtml } from '../jobvision/jobvisionSource.js';
import type { HttpClient } from '../http.js';

const SITE_BASE = 'https://www.irantalent.com';

/** Default category slugs to enumerate (configurable, not hardcoded logic). */
export const DEFAULT_IRANTALENT_CATEGORY_SLUGS = [
  'it-software-web-development-filter-jobs',
] as const;

export interface ItLocalized {
  id?: number;
  title?: string | null;
  title_farsi?: string | null;
  slug?: string | null;
}

export interface ItEmployer {
  id?: number;
  name?: string | null;
  name_farsi?: string | null;
  title?: string | null;
  slug?: string | null;
}

export interface ItAnonymousData {
  name_en?: string | null;
  name_en_fa?: string | null;
  name_fa?: string | null;
}

export interface ItPosition {
  id: number;
  title?: string | null;
  title_farsi?: string | null;
  slug?: string | null;
  salary_from?: number | null;
  salary_to?: number | null;
  is_show_salary?: boolean;
  work_type?: string | null; // 'on_site' | 'hybrid' | 'remote'
  employment_type?: ItLocalized | null;
  location?: (ItLocalized & { parent?: ItLocalized | null }) | null;
  location_text?: string | null;
  job_category?: ItLocalized[];
  seniority?: ItLocalized[];
  role_description?: string | null;
  role_description_farsi?: string | null;
  requirements_description?: string | null;
  employer?: ItEmployer | null;
  is_anonymous?: boolean;
  anonymous_data?: ItAnonymousData | null;
  created_at?: string | null;
  lived_at?: string | null;
  expired_at?: string | null;
  status?: ItLocalized | null;
  reference_code?: string | null;
  minimum_experience?: number | null;
}

interface ItEmbeddedSearch {
  current_page?: number;
  last_page?: number;
  total?: number;
  per_page?: number;
  data?: ItPosition[];
  boosted_positions?: ItPosition[];
}

const WORK_TYPE_MAP: Record<string, NormalizedJob['remote']> = {
  remote: 'remote',
  hybrid: 'hybrid',
  on_site: 'onsite',
};

const EMPLOYMENT_TITLE_MAP: Record<string, NormalizedJob['employmentType']> = {
  'full time': 'full_time',
  'part time': 'part_time',
  'full-time': 'full_time',
  'part-time': 'part_time',
  internship: 'internship',
  contract: 'contract',
  'temporary / contract': 'contract',
  freelance: 'freelance',
};

export class IranTalentSource {
  readonly id: SourceId = 'irantalent';

  private readonly http: HttpClient;
  private readonly siteUrl: string;
  private readonly categorySlugs: string[];
  private readonly maxPagesPerCategory: number;

  constructor(
    http: HttpClient,
    options: {
      siteUrl?: string;
      categorySlugs?: string[];
      maxPagesPerCategory?: number;
    } = {},
  ) {
    this.http = http;
    this.siteUrl = options.siteUrl ?? SITE_BASE;
    this.categorySlugs = options.categorySlugs ?? [...DEFAULT_IRANTALENT_CATEGORY_SLUGS];
    this.maxPagesPerCategory = options.maxPagesPerCategory ?? 10;
  }

  /**
   * Discover positions across configured category slugs.
   * Returns listings (id + public URL) for every found position.
   */
  async search(query: SearchQuery): Promise<SourceListing[]> {
    const rows = await this.searchRows(query);
    return rows
      .filter((p) => p?.id != null)
      .map((p) => ({
        source: this.id,
        externalId: String(p.id),
        url: this.jobUrl(String(p.id), p.slug ?? ''),
        fetchedAt: new Date(),
      }));
  }

  /** Raw list rows across all category slugs/pages. */
  async searchRows(query: SearchQuery): Promise<ItPosition[]> {
    const rows: ItPosition[] = [];
    const seen = new Set<number>();

    for (const slug of this.categorySlugs) {
      const maxPage = query.page ?? this.maxPagesPerCategory;
      for (let page = 1; page <= maxPage; page++) {
        const url = `${this.siteUrl}/en/jobs/${slug}?page=${page}`;
        const html = await this.http.requestText(url);
        const search = extractEmbeddedSearch(html);
        if (!search || !search.data || search.data.length === 0) break;

        for (const post of search.data) {
          if (post?.id == null || seen.has(post.id)) continue;
          seen.add(post.id);
          rows.push(post);
        }

        const lastPage = search.last_page ?? 1;
        if (page >= lastPage) break;
      }
    }

    return rows;
  }

  /**
   * Fetch one position. IranTalent list rows already carry the full
   * description, so callers pass the known row. Without it, the public
   * detail URL requires the position slug; we refuse to guess URLs and
   * search for the row instead.
   */
  async fetchJob(externalId: string, knownRow?: ItPosition): Promise<RawJobResult> {
    if (knownRow) {
      return {
        externalId,
        url: this.jobUrl(externalId, knownRow.slug ?? ''),
        data: knownRow,
      };
    }
    // Find the row in search results (no URL guessing).
    const rows = await this.searchRows({});
    const row = rows.find((r) => String(r.id) === externalId);
    if (!row) {
      throw new Error(
        `IranTalent detail failed for ${externalId}: position not found in search results`,
      );
    }
    return {
      externalId,
      url: this.jobUrl(externalId, row.slug ?? ''),
      data: row,
    };
  }

  /** Normalize a list row or detail payload into a NormalizedJob. */
  normalize(raw: ItPosition): NormalizedJob {
    const id = String(raw.id);
    const employerName =
      raw.is_anonymous && raw.anonymous_data
        ? (raw.anonymous_data.name_en ?? raw.anonymous_data.name_fa ?? 'Anonymous company')
        : (raw.employer?.name ??
          raw.employer?.title ??
          raw.employer?.name_farsi ??
          'Unknown company');

    const employmentType = raw.employment_type?.title
      ? (EMPLOYMENT_TITLE_MAP[raw.employment_type.title.toLowerCase()] ?? null)
      : null;

    const remote = raw.work_type ? (WORK_TYPE_MAP[raw.work_type] ?? null) : null;

    const location = raw.location_text?.trim() || raw.location?.title?.trim() || null;

    const description =
      stripHtml(raw.role_description ?? '') || stripHtml(raw.role_description_farsi ?? '');

    const postedAt = parseItDate(raw.lived_at ?? raw.created_at ?? null);

    // Salary is in Rials; keep raw values and mark currency.
    const hasSalary = Boolean(
      raw.is_show_salary && (raw.salary_from != null || raw.salary_to != null),
    );

    return {
      id: `irantalent:${id}`,
      source: this.id,
      externalId: id,
      title: (raw.title ?? raw.title_farsi ?? '').trim() || 'Untitled position',
      company: employerName,
      description,
      location,
      remote,
      employmentType,
      salaryMin: hasSalary ? (raw.salary_from ?? null) : null,
      salaryMax: hasSalary ? (raw.salary_to ?? null) : null,
      salaryCurrency: hasSalary ? 'IRR' : null,
      postedAt,
      url: this.jobUrl(id, raw.slug ?? ''),
      skills: [],
    };
  }

  jobUrl(externalId: string, slug: string): string {
    return slug ? `${this.siteUrl}/en/job/${slug}/${externalId}` : `${this.siteUrl}/en/jobs`;
  }
}

/** Parse IranTalent date strings: "2026-09-02" or "2026-09-02 15:10:35". */
export function parseItDate(value: string | null): Date | null {
  if (!value) return null;
  const iso = value.includes(' ')
    ? value.replace(' ', 'T') + 'Z' // site-local datetime; UTC approximation
    : value + 'T00:00:00Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Extract the `serverSideSearchResult` JSON object from SSR HTML using
 * brace matching (no regex parsing of nested JSON). The payload nests as
 * serverSideSearchResult.data.data[] (paginated envelope inside a wrapper).
 */
export function extractEmbeddedSearch(html: string): ItEmbeddedSearch | null {
  const key = '"serverSideSearchResult":';
  const i = html.indexOf(key);
  if (i < 0) return null;
  const parsed = extractBalancedJson(html, i + key.length);
  if (parsed == null) return null;
  const wrapper = parsed as { data?: ItEmbeddedSearch | ItPosition[] } | ItEmbeddedSearch;
  // Unwrap the common {"data": {paginated}} wrapper shape.
  if (wrapper && typeof wrapper === 'object' && 'data' in wrapper) {
    const inner = (wrapper as { data?: unknown }).data;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner as ItEmbeddedSearch;
    }
    if (Array.isArray(inner)) {
      return { data: inner } as ItEmbeddedSearch;
    }
  }
  return wrapper as ItEmbeddedSearch;
}

/**
 * Extract the position payload from a job-detail page's ng-state
 * TransferState script (find object containing role_description + id).
 */
export function extractEmbeddedPosition(html: string): ItPosition | null {
  const m = html.match(/<script id="ng-state"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let state: unknown;
  try {
    state = JSON.parse(m[1]);
  } catch {
    return null;
  }
  return findPositionInState(state, 0);
}

function findPositionInState(obj: unknown, depth: number): ItPosition | null {
  if (depth > 5) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findPositionInState(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    if ('role_description' in rec && 'id' in rec) return rec as unknown as ItPosition;
    for (const v of Object.values(rec)) {
      const found = findPositionInState(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractBalancedJson(html: string, start: number): unknown | null {
  let i = start;
  while (i < html.length && html[i] !== '{') {
    if (html[i] !== ' ') return null; // expected object
    i++;
  }
  if (i >= html.length) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  const from = i;
  while (i < html.length) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(from, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    i++;
  }
  return null;
}
