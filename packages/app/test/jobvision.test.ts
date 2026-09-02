import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  JobVisionSource,
  stripHtml,
  type JvJobPost,
} from '../src/sources/jobvision/jobvisionSource.js';
import type { HttpClient } from '../src/sources/http.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'jobvision');

const listEnvelope = JSON.parse(readFileSync(join(fixtures, 'list.json'), 'utf8'));
const detailEnvelope = JSON.parse(readFileSync(join(fixtures, 'detail-1455488.json'), 'utf8'));

/** Fake HTTP client with programmable responses — never touches the network. */
class FakeHttp implements HttpClient {
  calls: { url: string; method?: string; body?: unknown }[] = [];

  constructor(
    private readonly handler: (
      url: string,
      options: { method?: string; body?: unknown },
    ) => Promise<unknown>,
  ) {}

  requestJson<T>(url: string, options?: { method?: string; body?: unknown }): Promise<T> {
    this.calls.push({ url, method: options?.method, body: options?.body });
    return this.handler(url, options ?? {}) as Promise<T>;
  }
}

function listRow(id: number): JvJobPost {
  return listEnvelope.data.jobPosts.find((p: JvJobPost) => p.id === id);
}

const okDetail = detailEnvelope.data as JvJobPost;

describe('JobVisionSource.search', () => {
  it('discovers listings across pages and builds public URLs', async () => {
    let page = 0;
    const http = new FakeHttp(async () => {
      page++;
      // Page 1: 4 fixture posts; page 2: 1 repeated post; count says 5 total.
      const posts = page === 1 ? listEnvelope.data.jobPosts : [listEnvelope.data.jobPosts[0]];
      return { isSuccess: true, data: { jobPosts: posts, jobPostCount: 5 } };
    });
    const src = new JobVisionSource(http, { maxPages: 2, pageSize: 4 });

    const listings = await src.search({ keywords: ['node.js'] });

    expect(listings.length).toBe(5);
    expect(listings[0]).toMatchObject({
      source: 'jobvision',
      url: expect.stringMatching(/^https:\/\/jobvision\.ir\/jobs\/\d+$/),
    });
    expect(listings.every((l) => /^\d+$/.test(l.externalId))).toBe(true);
    expect(listings.every((l) => l.fetchedAt instanceof Date)).toBe(true);
    // camelCase body contract (PascalCase silently ignores filters!)
    const first = http.calls[0];
    expect(first.method).toBe('POST');
    expect(first.body).toMatchObject({
      keyword: 'node.js',
      requestedPage: 1,
      pageSize: 4,
      sortBy: 0,
    });
    expect((first.body as Record<string, unknown>).Query).toBeUndefined();
  });

  it('stops when a page comes back empty', async () => {
    const http = new FakeHttp(async () => ({
      isSuccess: true,
      data: { jobPosts: [], jobPostCount: 0 },
    }));
    const src = new JobVisionSource(http);
    const listings = await src.search({ keywords: ['nothing'] });
    expect(listings).toEqual([]);
    expect(http.calls).toHaveLength(1);
  });

  it('throws on business-level failure (isSuccess=false)', async () => {
    const http = new FakeHttp(async () => ({
      isSuccess: false,
      message: 'business error',
    }));
    const src = new JobVisionSource(http);
    await expect(src.search({})).rejects.toThrow(/JobVision list failed/);
  });

  it('throws on network failure', async () => {
    const http = new FakeHttp(async () => {
      throw new Error('ECONNRESET');
    });
    const src = new JobVisionSource(http);
    await expect(src.search({})).rejects.toThrow('ECONNRESET');
  });

  it('skips rows with missing ids but continues', async () => {
    const post = { ...listRow(1455488) };
    const broken = { ...post } as Record<string, unknown>;
    delete broken.id;
    const http = new FakeHttp(async () => ({
      isSuccess: true,
      data: { jobPosts: [broken, post], jobPostCount: 1 },
    }));
    const src = new JobVisionSource(http);
    const listings = await src.search({});
    expect(listings).toHaveLength(1);
    expect(listings[0].externalId).toBe('1455488');
  });
});

describe('JobVisionSource.fetchJob', () => {
  it('fetches detail by external id and returns raw payload', async () => {
    const http = new FakeHttp(async () => detailEnvelope);
    const src = new JobVisionSource(http);
    const result = await src.fetchJob('1455488');
    expect(result.externalId).toBe('1455488');
    expect(result.url).toBe('https://jobvision.ir/jobs/1455488');
    expect((result.data as JvJobPost).title).toBe('Node.js developer');
    expect(http.calls[0].url).toContain('/JobPost/Detail?jobPostId=1455488');
  });

  it('throws when detail is missing (expired/deleted job)', async () => {
    const http = new FakeHttp(async () => ({
      isSuccess: true,
      data: null,
    }));
    const src = new JobVisionSource(http);
    await expect(src.fetchJob('999999')).rejects.toThrow(/detail failed/);
  });

  it('throws on network failure', async () => {
    const http = new FakeHttp(async () => {
      throw new Error('socket hang up');
    });
    const src = new JobVisionSource(http);
    await expect(src.fetchJob('1')).rejects.toThrow('socket hang up');
  });
});

describe('JobVisionSource.normalize', () => {
  const src = new JobVisionSource(new FakeHttp(async () => ({})));

  it('normalizes a list row with all fields present', () => {
    const row = listRow(1492135); // برنامه نویس Back-End (Node.js), salary 40-70
    const job = src.normalize(row);
    expect(job).toMatchObject({
      id: 'jobvision:1492135',
      source: 'jobvision',
      externalId: '1492135',
      title: 'برنامه نویس Back-End (Node.js)',
      employmentType: 'full_time',
      salaryMin: 40,
      salaryMax: 70,
      salaryCurrency: 'IRT',
      url: 'https://jobvision.ir/jobs/1492135',
    });
    expect(job.postedAt).toBeInstanceOf(Date);
    expect(job.company.length).toBeGreaterThan(0);
  });

  it('normalizes a detail payload including skills and description', () => {
    const job = src.normalize(okDetail);
    expect(job.skills).toContain('Node.js');
    expect(job.skills).toContain('MongoDB');
    expect(job.description).not.toMatch(/<[^>]+>/); // HTML stripped
    expect(job.description.length).toBeGreaterThan(50);
    expect(job.remote).toBeNull(); // isRemote false in fixture
  });

  it('marks remote jobs when isRemote=true', () => {
    const job = src.normalize({ ...okDetail, isRemote: true, properties: { isRemote: true } });
    expect(job.remote).toBe('remote');
  });

  it('maps workType ids to employment types', () => {
    expect(src.normalize({ ...okDetail, workType: { id: 121 } }).employmentType).toBe('part_time');
    expect(src.normalize({ ...okDetail, workType: { id: 122 } }).employmentType).toBe('contract');
    expect(src.normalize({ ...okDetail, workType: { id: 999 } }).employmentType).toBeNull();
    expect(src.normalize({ ...okDetail, workType: null }).employmentType).toBeNull();
  });

  it('treats internship flag as employment type override', () => {
    const job = src.normalize({
      ...okDetail,
      workType: { id: 120 },
      properties: { isInternship: true },
    });
    expect(job.employmentType).toBe('internship');
  });

  it('handles missing/null salary, location, company gracefully', () => {
    const job = src.normalize({
      id: 1,
      title: 'Bare job',
      salary: null,
      company: null,
      location: null,
      workType: null,
      activationTime: null,
    });
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.salaryCurrency).toBeNull();
    expect(job.location).toBeNull();
    expect(job.company).toBe('Unknown company');
    expect(job.postedAt).toBeNull();
    expect(job.employmentType).toBeNull();
  });

  it('rejects malformed rows: missing title falls back, invalid date ignored', () => {
    const job = src.normalize({
      id: 2,
      title: null as unknown as string,
      activationTime: { date: 'not-a-date' },
    });
    expect(job.title).toBe('Untitled position');
    expect(job.postedAt).toBeNull();
  });

  it('formats city+province without duplication (Tehran, Tehran → Tehran)', () => {
    const job = src.normalize({
      ...okDetail,
      location: {
        province: { titleEn: 'Tehran' },
        city: { titleEn: 'Tehran' },
      },
    });
    expect(job.location).toBe('Tehran');
  });

  it('merges list row + detail (list wins for structural fields, detail for content)', () => {
    const row = listRow(1455488);
    const merged = src.normalizeWithDetail(row, okDetail);
    expect(merged.skills).toContain('Node.js');
    expect(merged.employmentType).toBe('full_time');
    expect(merged.description).not.toBe('');
  });
});

describe('stripHtml', () => {
  it('converts HTML to readable plain text', () => {
    const out = stripHtml(
      '<div dir="rtl"><p>Line one</p><p>Line <strong>two</strong></p><ul><li>a</li><li>b</li></ul></div>',
    );
    expect(out).toContain('Line one');
    expect(out).toContain('Line two');
    expect(out).toContain('• a');
    expect(out).not.toMatch(/<[^>]+>/);
  });

  it('decodes common entities', () => {
    expect(stripHtml('a &amp; b &nbsp; c &lt;x&gt;')).toBe('a & b c <x>');
    expect(stripHtml('q &quot;quoted&#39;')).toBe('q "quoted\'');
  });
});
