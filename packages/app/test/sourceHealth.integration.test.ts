import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SourceHealthMonitor } from '../src/monitoring/sourceHealth.js';
import { buildApp } from '../src/server.js';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'warn';

d('source health monitoring + ops endpoints (M9)', () => {
  let prisma: PrismaClient;
  let monitor: SourceHealthMonitor;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    monitor = new SourceHealthMonitor(prisma);
    await prisma.jobSource.upsert({
      where: { id: 'health-src' },
      create: { id: 'health-src', name: 'Health Test' },
      update: {},
    });
    await prisma.sourceRun.deleteMany({ where: { sourceId: 'health-src' } });

    const now = Date.now();
    await prisma.sourceRun.createMany({
      data: [
        {
          sourceId: 'health-src',
          startedAt: new Date(now - 60 * 60_000),
          finishedAt: new Date(now - 60 * 60_000 + 5000),
          status: 'success',
          found: 20,
          created: 10,
        },
        {
          sourceId: 'health-src',
          startedAt: new Date(now - 30 * 60_000),
          finishedAt: new Date(now - 30 * 60_000 + 4000),
          status: 'failed',
          errorDetails: ['search failed: ECONNRESET'],
        },
        {
          sourceId: 'health-src',
          startedAt: new Date(now - 10 * 60_000),
          finishedAt: new Date(now - 10 * 60_000 + 6000),
          status: 'partial',
          found: 10,
          created: 5,
          errors: 2,
          errorDetails: ['job 1: HTTP 404', 'job 2: HTTP 404'],
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.sourceRun.deleteMany({ where: { sourceId: 'health-src' } });
    await prisma.jobSource.delete({ where: { id: 'health-src' } }).catch(() => null);
    await prisma.$disconnect();
  });

  it('aggregates per-source health from recent runs', async () => {
    const reports = await monitor.sourceHealth();
    const src = reports.find((r) => r.sourceId === 'health-src');
    expect(src).toBeDefined();
    expect(src!.runsLast24h).toBe(3);
    expect(src!.consecutiveFailures).toBe(0); // latest run is partial, not failed
    expect(src!.lastStatus).toBe('partial');
    expect(src!.lastError).toContain('HTTP 404');
    expect(src!.jobsFoundLast24h).toBe(30);
    expect(src!.jobsCreatedLast24h).toBe(15);
    expect(src!.successRate).toBeCloseTo(2 / 3, 2);
    expect(src!.healthy).toBe(true);
  });

  it('marks sources with consecutive failures unhealthy', async () => {
    await prisma.sourceRun.createMany({
      data: [
        {
          sourceId: 'health-src',
          startedAt: new Date(Date.now() - 2 * 60_000),
          status: 'failed',
          errorDetails: ['search failed'],
        },
        {
          sourceId: 'health-src',
          startedAt: new Date(Date.now() - 60_000),
          status: 'failed',
          errorDetails: ['search failed'],
        },
        {
          sourceId: 'health-src',
          startedAt: new Date(Date.now() - 30_000),
          status: 'failed',
          errorDetails: ['search failed'],
        },
      ],
    });

    const reports = await monitor.sourceHealth();
    const src = reports.find((r) => r.sourceId === 'health-src');
    expect(src!.consecutiveFailures).toBe(3);
    expect(src!.healthy).toBe(false);
  });

  it('exposes /health and /ops/sources/health via the API', async () => {
    const { app, prisma: appPrisma } = await buildApp({ prisma });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('ok');

    const sources = await app.inject({ method: 'GET', url: '/ops/sources/health' });
    expect(sources.statusCode).toBe(200);
    const body = sources.json();
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.some((s: { sourceId: string }) => s.sourceId === 'health-src')).toBe(true);

    await app.close();
    await appPrisma.$disconnect().catch(() => null);
  });

  it('validates match status transitions on the ops endpoint', async () => {
    const { app, prisma: appPrisma } = await buildApp({ prisma });

    const user = await appPrisma.user.create({
      data: { email: `ops-${Date.now()}@example.com` },
    });
    const job = await appPrisma.job.create({
      data: {
        logicalKey: `ops-${Date.now()}`,
        title: 'ops job',
        company: 'ops co',
        description: 'd',
        contentHash: `ops-${Math.random()}`,
        sourceId: 'jobvision',
        externalId: `ops-${Math.random()}`,
        canonicalUrl: 'https://x/1',
      },
    });
    const profile = await appPrisma.searchProfile.create({
      data: {
        userId: user.id,
        name: 'ops',
        targetTitles: [],
        requiredKeywords: [],
        preferredKeywords: [],
        excludedKeywords: [],
        locations: [],
        employmentTypes: [],
        remotePolicies: [],
      },
    });
    const cand = await appPrisma.candidateProfile.create({
      data: { userId: user.id, profile: {} },
    });
    const match = await appPrisma.jobMatch.create({
      data: {
        jobId: job.id,
        searchProfileId: profile.id,
        candidateProfileId: cand.id,
        score: 80,
        recommendation: 'good_match',
        matchedSkills: [],
        missingSkills: [],
        explanation: 'ops',
        status: 'new',
      },
    });

    // new → saved is valid
    const ok = await app.inject({
      method: 'POST',
      url: `/ops/matches/${match.id}/status`,
      payload: { to: 'saved' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('saved');

    // feedback persisted
    const feedback = await appPrisma.feedback.findFirst({
      where: { userId: user.id, jobId: job.id, action: 'saved' },
    });
    expect(feedback).not.toBeNull();

    // saved → applied valid
    const applied = await app.inject({
      method: 'POST',
      url: `/ops/matches/${match.id}/status`,
      payload: { to: 'applied' },
    });
    expect(applied.statusCode).toBe(200);

    // applied → not_relevant is blocked (terminal-ish state)
    const blocked = await app.inject({
      method: 'POST',
      url: `/ops/matches/${match.id}/status`,
      payload: { to: 'not_relevant' },
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error).toContain('invalid transition');

    // unknown match → 404
    const missing = await app.inject({
      method: 'POST',
      url: '/ops/matches/nonexistent/status',
      payload: { to: 'saved' },
    });
    expect(missing.statusCode).toBe(404);

    await app.close();
    await appPrisma.feedback.deleteMany({ where: { userId: user.id } });
    await appPrisma.jobMatch.deleteMany({ where: { searchProfileId: profile.id } });
    await appPrisma.job.deleteMany({ where: { id: job.id } });
    await appPrisma.searchProfile.deleteMany({ where: { id: profile.id } });
    await appPrisma.candidateProfile.deleteMany({ where: { userId: user.id } });
    await appPrisma.user.delete({ where: { id: user.id } });
    await appPrisma.$disconnect();
  });
});
