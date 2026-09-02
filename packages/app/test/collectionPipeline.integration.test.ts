import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runJobVisionCollection } from '../src/pipeline/collection.js';
import { JobVisionSource, type JvJobPost } from '../src/sources/jobvision/jobvisionSource.js';
import { JobRepository } from '../src/repositories/jobRepository.js';
import type { HttpClient } from '../src/sources/http.js';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'jobvision');
const listEnvelope = JSON.parse(readFileSync(join(fixtures, 'list.json'), 'utf8'));
const detailEnvelope = JSON.parse(readFileSync(join(fixtures, 'detail-1455488.json'), 'utf8'));

class FakeHttp implements HttpClient {
  private page = 0;

  constructor(
    private readonly behavior: {
      failSearch?: boolean;
      failDetailFor?: string[];
    } = {},
  ) {}

  requestJson<T>(url: string, options?: { body?: unknown }): Promise<T> {
    if (this.behavior.failSearch && url.includes('/JobPost/List')) {
      return Promise.reject(new Error('ECONNRESET'));
    }
    if (url.includes('/JobPost/Detail')) {
      const id = new URL(url, 'https://x').searchParams.get('jobPostId') ?? '';
      if (this.behavior.failDetailFor?.includes(id)) {
        return Promise.reject(new Error(`HTTP 404 for ${url}`));
      }
      return Promise.resolve({
        isSuccess: true,
        data: { ...(detailEnvelope.data as JvJobPost), id: Number(id) },
      } as T);
    }
    if (url.includes('/JobPost/List')) {
      this.page++;
      const requestedPage = (options?.body as { requestedPage?: number } | undefined)
        ?.requestedPage;
      // Page 1: the 4 fixture posts; page 2+: empty (end of results).
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
}

d('JobVision collection pipeline', () => {
  let prisma: PrismaClient;
  let repo: JobRepository;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    repo = new JobRepository(prisma);
    // cleanup any leftovers from previous runs
    await prisma.job.deleteMany({ where: { sourceId: 'jobvision' } });
    await prisma.sourceRun.deleteMany({ where: { sourceId: 'jobvision' } });
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { sourceId: 'jobvision' } });
    await prisma.sourceRun.deleteMany({ where: { sourceId: 'jobvision' } });
    await prisma.$disconnect();
  });

  it('runs a full search→fetch→normalize→persist pass', async () => {
    const source = new JobVisionSource(new FakeHttp());
    const result = await runJobVisionCollection(source, repo, { keywords: ['node.js'] });

    expect(result.status).toBe('success');
    expect(result.found).toBe(4); // fixture has 4 posts
    expect(result.created).toBe(4);
    expect(result.errors).toBe(0);

    const runs = await prisma.sourceRun.findMany({
      where: { sourceId: 'jobvision' },
      orderBy: { startedAt: 'desc' },
    });
    expect(runs[0].status).toBe('success');
    expect(runs[0].found).toBe(4);
    expect(runs[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('second run finds only duplicates (idempotent restart-safety)', async () => {
    const source = new JobVisionSource(new FakeHttp());
    const result = await runJobVisionCollection(source, repo, { keywords: ['node.js'] });

    expect(result.created).toBe(0);
    expect(result.duplicates).toBe(4);
    expect(result.status).toBe('success');
  });

  it('tolerates individual detail failures and reports partial status', async () => {
    const source = new JobVisionSource(new FakeHttp({ failDetailFor: ['1455488', '1492135'] }));
    const result = await runJobVisionCollection(source, repo, { keywords: ['node.js'] });

    expect(result.status).toBe('partial');
    expect(result.errors).toBe(2);
    expect(result.errorDetails.join(' ')).toMatch(/404/);
    // Other jobs still processed
    expect(result.duplicates).toBe(2);

    const run = await prisma.sourceRun.findFirst({
      where: { sourceId: 'jobvision', status: 'partial' },
      orderBy: { startedAt: 'desc' },
    });
    expect(run?.errors).toBe(2);
  });

  it('records a failed run when search itself fails', async () => {
    const source = new JobVisionSource(new FakeHttp({ failSearch: true }));
    const result = await runJobVisionCollection(source, repo, { keywords: ['node.js'] });

    expect(result.status).toBe('failed');
    expect(result.found).toBe(0);
    expect(result.errorDetails.join(' ')).toMatch(/search failed/);

    const run = await prisma.sourceRun.findFirst({
      where: { sourceId: 'jobvision', status: 'failed' },
      orderBy: { startedAt: 'desc' },
    });
    expect(run).not.toBeNull();
  });
});
