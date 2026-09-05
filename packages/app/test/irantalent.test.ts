import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IranTalentSource,
  extractEmbeddedSearch,
  extractEmbeddedPosition,
  parseItDate,
  type ItPosition,
} from '../src/sources/irantalent/irantalentSource.js';
import type { HttpClient } from '../src/sources/http.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'irantalent');

const listFixture = JSON.parse(readFileSync(join(fixtures, 'list.json'), 'utf8')) as {
  data: ItPosition[];
  last_page: number;
  total: number;
};
const detailFixture = JSON.parse(
  readFileSync(join(fixtures, 'detail-182473.json'), 'utf8'),
) as ItPosition;

/** Fake HTTP client that returns SSR HTML pages built from fixtures. */
class FakeHttp implements HttpClient {
  calls: string[] = [];

  constructor(
    private readonly behavior: {
      failSearch?: boolean;
      pageWithPosts?: ItPosition[][]; // per successive page call
    } = {},
  ) {}

  requestJson(): Promise<never> {
    return Promise.reject(new Error('IranTalent tests use requestText only'));
  }

  async requestText(url: string): Promise<string> {
    this.calls.push(url);
    if (this.behavior.failSearch && url.includes('/en/jobs/')) {
      throw new Error('ECONNRESET');
    }
    if (url.includes('/en/job/')) {
      return buildDetailHtml(detailFixture);
    }
    const posts = this.behavior.pageWithPosts;
    if (posts) {
      const pageIdx = this.searchPageCalls - 1;
      const data = posts[Math.min(pageIdx, posts.length - 1)] ?? [];
      return buildListHtml(data, posts.length);
    }
    return buildListHtml(listFixture.data, listFixture.last_page);
  }
  private get searchPageCalls(): number {
    return this.calls.filter((u) => u.includes('/en/jobs/') && u.includes('page=')).length;
  }
}

function buildListHtml(data: ItPosition[], lastPage: number): string {
  const payload = JSON.stringify({
    serverSideSearchResult: { data: { current_page: 1, last_page: lastPage, data } },
  });
  return `<html><body><script>window.__STATE__=${payload};</script></body></html>`;
}

function buildDetailHtml(position: ItPosition): string {
  const state = JSON.stringify({ '123456': position });
  return `<html><body><script id="ng-state" type="application/json">${state}</script></body></html>`;
}

const src = new IranTalentSource(new FakeHttp());

describe('IranTalentSource.search', () => {
  it('discovers listings across category pages with public job URLs', async () => {
    const http = new FakeHttp();
    const source = new IranTalentSource(http, { maxPagesPerCategory: 1 });
    const listings = await source.search({});

    expect(listings.length).toBeGreaterThan(0);
    expect(listings[0]).toMatchObject({
      source: 'irantalent',
      externalId: String(listFixture.data[0].id),
      url: expect.stringMatching(/\/job\/[a-z0-9-]+\/\d+$/),
    });
    expect(http.calls[0]).toContain('/en/jobs/it-software-web-development-filter-jobs?page=1');
  });

  it('stops at last_page and skips duplicates across pages', async () => {
    const post = listFixture.data[0];
    const http = new FakeHttp({ pageWithPosts: [[post], [post, post]] });
    const source = new IranTalentSource(http, { maxPagesPerCategory: 5 });
    const rows = await source.searchRows({});
    // same post repeated on page 2 — dedup by id
    expect(rows).toHaveLength(1);
    expect(http.calls.filter((u) => u.includes('page=2'))).toHaveLength(1);
  });

  it('stops when a page comes back empty', async () => {
    const http = new FakeHttp({ pageWithPosts: [[], []] });
    const source = new IranTalentSource(http);
    const rows = await source.searchRows({});
    expect(rows).toHaveLength(0);
    expect(http.calls.filter((u) => u.includes('page='))).toHaveLength(1);
  });

  it('throws when search fails (network)', async () => {
    const source = new IranTalentSource(new FakeHttp({ failSearch: true }));
    await expect(source.search({})).rejects.toThrow('ECONNRESET');
  });

  it('returns empty (not throw) when HTML has no embedded state', async () => {
    const http = new FakeHttp();
    http.requestText = async () => '<html><body>nothing here</body></html>';
    const source = new IranTalentSource(http);
    const rows = await source.searchRows({});
    expect(rows).toEqual([]);
  });
});

describe('IranTalentSource.normalize', () => {
  it('normalizes a full list row', () => {
    const row = listFixture.data[0];
    const job = src.normalize(row);
    expect(job).toMatchObject({
      id: `irantalent:${row.id}`,
      source: 'irantalent',
      externalId: String(row.id),
      title: row.title,
      company: row.employer?.name,
      location: row.location_text,
      url: expect.stringContaining(`/job/${row.slug}/${row.id}`),
    });
    expect(job.description.length).toBeGreaterThan(50);
    expect(job.description).not.toMatch(/<[^>]+>/);
  });

  it('maps work_type to remote policy', () => {
    const row = listFixture.data[0];
    expect(src.normalize({ ...row, work_type: 'remote' }).remote).toBe('remote');
    expect(src.normalize({ ...row, work_type: 'hybrid' }).remote).toBe('hybrid');
    expect(src.normalize({ ...row, work_type: 'on_site' }).remote).toBe('onsite');
    expect(src.normalize({ ...row, work_type: null }).remote).toBeNull();
  });

  it('maps employment type titles', () => {
    const row = listFixture.data[0];
    expect(src.normalize({ ...row, employment_type: { title: 'Full Time' } }).employmentType).toBe(
      'full_time',
    );
    expect(src.normalize({ ...row, employment_type: { title: 'Part Time' } }).employmentType).toBe(
      'part_time',
    );
    expect(src.normalize({ ...row, employment_type: { title: 'Internship' } }).employmentType).toBe(
      'internship',
    );
    expect(
      src.normalize({ ...row, employment_type: { title: 'Weird Type' } }).employmentType,
    ).toBeNull();
    expect(src.normalize({ ...row, employment_type: null }).employmentType).toBeNull();
  });

  it('handles anonymous employers via anonymous_data', () => {
    const row = listFixture.data[0];
    const job = src.normalize({
      ...row,
      is_anonymous: true,
      anonymous_data: { name_en: 'Confidential Co' },
    });
    expect(job.company).toBe('Confidential Co');
  });

  it('exposes salary only when shown, in Rials', () => {
    const row =
      listFixture.data.find((p) => p.is_show_salary && p.salary_from != null) ??
      listFixture.data[0];
    const job = src.normalize({
      ...row,
      is_show_salary: true,
      salary_from: 450000000,
      salary_to: 600000000,
    });
    expect(job.salaryMin).toBe(450000000);
    expect(job.salaryMax).toBe(600000000);
    expect(job.salaryCurrency).toBe('IRR');

    const hidden = src.normalize({ ...row, is_show_salary: false, salary_from: 100 });
    expect(hidden.salaryMin).toBeNull();
    expect(hidden.salaryCurrency).toBeNull();
  });

  it('parses posted dates from lived_at/created_at', () => {
    const row = listFixture.data[0];
    const job = src.normalize({ ...row, lived_at: '2026-09-02 15:10:35' });
    expect(job.postedAt).toBeInstanceOf(Date);
    expect(job.postedAt?.getUTCFullYear()).toBe(2026);
    const dateOnly = src.normalize({ ...row, lived_at: null, created_at: '2026-08-30' });
    expect(dateOnly.postedAt?.getUTCDate()).toBe(30);
    const none = src.normalize({ ...row, lived_at: null, created_at: null });
    expect(none.postedAt).toBeNull();
  });

  it('handles missing/null fields gracefully', () => {
    const job = src.normalize({
      id: 99,
      title: null,
      slug: null,
      employer: null,
      is_anonymous: false,
      location: null,
      location_text: null,
      role_description: null,
      work_type: null,
      employment_type: null,
      salary_from: null,
      salary_to: null,
      is_show_salary: false,
      lived_at: null,
      created_at: null,
    });
    expect(job.title).toBe('Untitled position');
    expect(job.company).toBe('Unknown company');
    expect(job.location).toBeNull();
    expect(job.description).toBe('');
    expect(job.url).toBe('https://www.irantalent.com/jobs');
  });

  it('normalizes the detail fixture (requirements included)', () => {
    const job = src.normalize(detailFixture);
    expect(job.id).toBe(`irantalent:${detailFixture.id}`);
    expect(job.company).toBe(detailFixture.employer?.name);
    expect(job.description.length).toBeGreaterThan(100);
  });
});

describe('IranTalentSource.fetchJob', () => {
  it('returns a known row directly without a network call', async () => {
    const http = new FakeHttp();
    const source = new IranTalentSource(http);
    const result = await source.fetchJob(String(listFixture.data[0].id), listFixture.data[0]);
    expect(result.externalId).toBe(String(listFixture.data[0].id));
    expect(http.calls).toHaveLength(0);
  });

  it('finds the row via search when no known row is given', async () => {
    const source = new IranTalentSource(new FakeHttp());
    const result = await source.fetchJob(String(listFixture.data[0].id));
    expect((result.data as ItPosition).id).toBe(listFixture.data[0].id);
  });

  it('throws when the position is not found in search results', async () => {
    const source = new IranTalentSource(new FakeHttp());
    await expect(source.fetchJob('999999')).rejects.toThrow(/not found/);
  });
});

describe('embedded state extraction', () => {
  it('extracts balanced JSON from SSR HTML', () => {
    const html = buildListHtml(listFixture.data, 3);
    const search = extractEmbeddedSearch(html);
    expect(search?.data?.length).toBe(listFixture.data.length);
  });

  it('returns null for malformed HTML', () => {
    expect(extractEmbeddedSearch('<html>truncated{"unclosed":')).toBeNull();
    expect(extractEmbeddedSearch('')).toBeNull();
  });

  it('extracts position from ng-state script', () => {
    const html = buildDetailHtml(detailFixture);
    const pos = extractEmbeddedPosition(html);
    expect(pos?.id).toBe(detailFixture.id);
  });

  it('extractEmbeddedPosition handles missing script', () => {
    expect(extractEmbeddedPosition('<html></html>')).toBeNull();
  });

  it('handles unicode escapes inside embedded JSON', () => {
    const html = `<script>x = {"serverSideSearchResult": {"data": {"data": [{"id": 5, "title": "مهندس \\u0646\\u0631\\u0645"}]}}};</script>`;
    const search = extractEmbeddedSearch(html);
    expect(search).not.toBeNull();
  });
});

describe('parseItDate', () => {
  it('parses datetime and date-only forms', () => {
    expect(parseItDate('2026-09-02 15:10:35')?.toISOString()).toBe('2026-09-02T15:10:35.000Z');
    expect(parseItDate('2026-09-02')?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(parseItDate(null)).toBeNull();
    expect(parseItDate('garbage')).toBeNull();
  });
});
