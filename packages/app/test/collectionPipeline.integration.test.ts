import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  runAllCollections,
  runIranTalentCollection,
  runJobVisionCollection,
} from '../src/pipeline/collection.js';
import { JobVisionSource, type JvJobPost } from '../src/sources/jobvision/jobvisionSource.js';
import { IranTalentSource, type ItPosition } from '../src/sources/irantalent/irantalentSource.js';
import { JobRepository } from '../src/repositories/jobRepository.js';
import type { HttpClient } from '../src/sources/http.js';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

const here = dirname(fileURLToPath(import.meta.url));
const jvFixtures = join(here, 'fixtures', 'jobvision');
const itFixtures = join(here, 'fixtures', 'irantalent');
const listEnvelope = JSON.parse(readFileSync(join(jvFixtures, 'list.json'), 'utf8'));
const detailEnvelope = JSON.parse(readFileSync(join(jvFixtures, 'detail-1455488.json'), 'utf8'));
const itList = JSON.parse(readFileSync(join(itFixtures, 'list.json'), 'utf8')) as {
  data: ItPosition[];
};

class JvFakeHttp implements HttpClient {
  constructor(private readonly behavior: { failSearch?: boolean } = {}) {}

  requestJson<T>(url: string, options?: { body?: unknown }): Promise<T> {
    if (this.behavior.failSearch && url.includes('/JobPost/List')) {
      return Promise.reject(new Error('ECONNRESET'));
    }
    if (url.includes('/JobPost/Detail')) {
      const id = new URL(url, 'https://x').searchParams.get('jobPostId') ?? '';
      return Promise.resolve({
        isSuccess: true,
        data: { ...(detailEnvelope.data as JvJobPost), id: Number(id) },
      } as T);
    }
    if (url.includes('/JobPost/List')) {
      const requestedPage = (options?.body as { requestedPage?: number } | undefined)
        ?.requestedPage;
      const posts = (requestedPage ?? 1) === 1 ? listEnvelope.data.jobPosts : [];
      return Promise.resolve({
        isSuccess: true,
        data: {
          jobPosts: posts,
          jobPostCount: listEnvelope.data.jobPosts.length,
          currentPage: requestedPage,
        },
      } as unknown as T);
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  }

  async requestText(): Promise<string> {
    throw new Error('JobVision uses JSON only');
  }
}

class ItFakeHttp implements HttpClient {
  constructor(private readonly behavior: { failSearch?: boolean } = {}) {}

  requestJson(): Promise<never> {
    throw new Error('IranTalent uses text only');
  }

  async requestText(url: string): Promise<string> {
    if (this.behavior.failSearch && url.includes('/en/jobs/')) {
      throw new Error('ECONNRESET');
    }
    const page = Number(new URL(url, 'https://x').searchParams.get('page') ?? '1');
    const data = page === 1 ? itList.data : [];
    const payload = JSON.stringify({
      serverSideSearchResult: {
        data: { current_page: page, last_page: 1, total: itList.data.length, data },
      },
    });
    return `<html><body><script>x=${payload};</script></body></html>`;
  }
}

d('Job collection pipelines', () => {
  let prisma: PrismaClient;
  let repo: JobRepository;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    repo = new JobRepository(prisma);
    await prisma.job.deleteMany({ where: { sourceId: { in: ['jobvision', 'irantalent'] } } });
    await prisma.sourceRun.deleteMany({
      where: { sourceId: { in: ['jobvision', 'irantalent'] } },
    });
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { sourceId: { in: ['jobvision', 'irantalent'] } } });
    await prisma.sourceRun.deleteMany({
      where: { sourceId: { in: ['jobvision', 'irantalent'] } },
    });
    await prisma.$disconnect();
  });

  it('JobVision: full search→fetch→normalize→persist pass', async () => {
    const source = new JobVisionSource(new JvFakeHttp());
    const result = await runJobVisionCollection(source, repo, { keywords: ['node.js'] });

    expect(result.status).toBe('success');
    expect(result.found).toBe(4);
    expect(result.created).toBe(4);
    expect(result.errors).toBe(0);
  });

  it('JobVision: second run is idempotent (all duplicates)', async () => {
    const source = new JobVisionSource(new JvFakeHttp());
    const result = await runJobVisionCollection(source, repo, { keywords: ['node.js'] });
    expect(result.created).toBe(0);
    expect(result.duplicates).toBe(4);
  });

  it('JobVision: search failure records failed run', async () => {
    const source = new JobVisionSource(new JvFakeHttp({ failSearch: true }));
    const result = await runJobVisionCollection(source, repo, {});
    expect(result.status).toBe('failed');
    expect(result.errorDetails.join(' ')).toMatch(/search failed/);
    const run = await prisma.sourceRun.findFirst({
      where: { sourceId: 'jobvision', status: 'failed' },
      orderBy: { startedAt: 'desc' },
    });
    expect(run).not.toBeNull();
  });

  it('IranTalent: full search→normalize→persist pass', async () => {
    const source = new IranTalentSource(new ItFakeHttp());
    const result = await runIranTalentCollection(source, repo, {});

    expect(result.status).toBe('success');
    expect(result.found).toBe(itList.data.length);
    expect(result.created).toBe(itList.data.length);

    const jobs = await prisma.job.findMany({ where: { sourceId: 'irantalent' } });
    expect(jobs).toHaveLength(itList.data.length);
    // descriptions were HTML-stripped
    expect(jobs.every((j) => !j.description.includes('<'))).toBe(true);
  });

  it('IranTalent: idempotent second run', async () => {
    const source = new IranTalentSource(new ItFakeHttp());
    const result = await runIranTalentCollection(source, repo, {});
    expect(result.created).toBe(0);
    expect(result.duplicates).toBe(itList.data.length);
  });

  it('IranTalent: search failure records failed run, does not throw', async () => {
    const source = new IranTalentSource(new ItFakeHttp({ failSearch: true }));
    const result = await runIranTalentCollection(source, repo, {});
    expect(result.status).toBe('failed');
    expect(result.errorDetails.join(' ')).toMatch(/search failed/);
  });

  it('source isolation: JobVision fails while IranTalent still succeeds', async () => {
    const results = await runAllCollections([
      {
        run: () =>
          runJobVisionCollection(
            new JobVisionSource(new JvFakeHttp({ failSearch: true })),
            repo,
            {},
          ),
      },
      { run: () => runIranTalentCollection(new IranTalentSource(new ItFakeHttp()), repo, {}) },
    ]);

    expect(results).toHaveLength(2);
    const jv = results.find((r) => r.sourceId === 'jobvision');
    const it = results.find((r) => r.sourceId === 'irantalent');
    expect(jv?.status).toBe('failed');
    expect(it?.status).toBe('success');
    expect(it?.created + it?.duplicates).toBe(itList.data.length);
  });
});
