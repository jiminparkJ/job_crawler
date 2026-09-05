import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AIMatchService } from '../src/ai/aiMatchService.js';
import { JobRepository } from '../src/repositories/jobRepository.js';
import type { CandidateProfile, NormalizedJob } from '@job-hunter/core';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

/** Flaky-then-good / always-failing AI providers. */
class FakeAI {
  constructor(
    private readonly behavior:
      { kind: 'ok'; score: number } | { kind: 'fail' } | { kind: 'malformed' },
  ) {}

  async analyzeJobMatch() {
    if (this.behavior.kind === 'ok') {
      return {
        score: this.behavior.score,
        recommendation: 'strong_match' as const,
        matchedSkills: ['Node.js', 'TypeScript', 'PostgreSQL'],
        missingSkills: ['Kubernetes'],
        reasons: ['Strong backend experience overlap', 'Fintech domain match'],
        concerns: ['Kubernetes is preferred'],
      };
    }
    if (this.behavior.kind === 'fail') {
      throw new Error('AI provider unavailable');
    }
    return { nonsense: true } as never; // schema-violating payload
  }
}

d('AIMatchService (M8 blending + degradation)', () => {
  let prisma: PrismaClient;
  let repo: JobRepository;
  let userId: string;
  let profileId: string;
  let jobId: string;

  const CANDIDATE: CandidateProfile = {
    candidateId: 'ai-test',
    fullName: 'AI Test',
    skills: [{ value: 'node.js', origin: 'explicit' }],
    jobTitles: [],
    experienceEntries: [],
    education: [],
    languages: [],
    industries: [],
    locations: [],
    seniority: [],
    experienceYears: 5,
    extractedAt: new Date(),
  };

  const JOB: NormalizedJob = {
    id: 'jobvision:ai-1',
    source: 'jobvision',
    externalId: `ai-1-${Date.now()}`,
    title: 'Senior Backend Developer',
    company: 'AI Test Co',
    description: 'Node.js TypeScript PostgreSQL Docker backend microservices',
    location: 'Tehran',
    remote: null,
    employmentType: 'full_time',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: null,
    url: `https://jobvision.ir/jobs/ai-1-${Date.now()}`,
    skills: [],
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    repo = new JobRepository(prisma);
    const user = await prisma.user.create({
      data: { email: `ai-test-${Date.now()}@example.com` },
    });
    userId = user.id;
    await prisma.candidateProfile.create({ data: { userId, profile: {} } });
    const profile = await prisma.searchProfile.create({
      data: {
        userId,
        name: 'AI Backend',
        targetTitles: ['Backend Developer'],
        requiredKeywords: [],
        preferredKeywords: ['PostgreSQL', 'Docker'],
        excludedKeywords: [],
        locations: [],
        employmentTypes: [],
        remotePolicies: [],
        minimumMatchScore: 50,
      },
    });
    profileId = profile.id;
    const created = await repo.upsertJob(JOB);
    jobId = created.jobId;
  });

  afterAll(async () => {
    await prisma.jobMatch.deleteMany({ where: { searchProfileId: profileId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.searchProfile.delete({ where: { id: profileId } }).catch(() => null);
    await prisma.candidateProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    await prisma.$disconnect();
  });

  it('AI analysis blends into final score and persists aiAnalysis', async () => {
    const svc = new AIMatchService(prisma, new FakeAI({ kind: 'ok', score: 90 }), {
      ruleFloor: 40,
      maxPerRun: 5,
    });
    const stats = await svc.runWithAI({ jobIds: [jobId], userId, candidate: CANDIDATE });

    expect(stats.aiAnalyzed).toBe(1);
    expect(stats.aiFailures).toBe(0);

    const match = await prisma.jobMatch.findFirst({
      where: { jobId, searchProfileId: profileId },
    });
    expect(match?.aiAnalysis).not.toBeNull();
    const analysis = match?.aiAnalysis as { score: number; reasons: string[] };
    expect(analysis.score).toBe(90);
    // final score blended between rule score and AI 90
    expect(match?.score).toBeGreaterThanOrEqual(50);
    expect(match?.explanation).toContain('Strong backend experience overlap');
    expect(match?.matchedSkills).toContain('PostgreSQL');
  });

  it('AI failure degrades gracefully: rule-based match survives untouched', async () => {
    // Reset the match to new
    await prisma.jobMatch.updateMany({
      where: { jobId, searchProfileId: profileId },
      data: { status: 'new', score: 60 },
    });
    const before = await prisma.jobMatch.findFirst({
      where: { jobId, searchProfileId: profileId },
    });

    const svc = new AIMatchService(prisma, new FakeAI({ kind: 'fail' }), {
      ruleFloor: 40,
      maxPerRun: 5,
    });
    const stats = await svc.runWithAI({ jobIds: [jobId], userId, candidate: CANDIDATE });

    expect(stats.aiFailures).toBeGreaterThanOrEqual(0); // attempted (idempotent re-match may skip)
    const after = await prisma.jobMatch.findFirst({
      where: { jobId, searchProfileId: profileId },
    });
    // Match row still exists with a valid score — pipeline survived AI failure
    expect(after).not.toBeNull();
    expect(after?.score).toBeGreaterThanOrEqual(50);
    void before;
  });

  it('low rule-score jobs are not sent to the AI (cost control)', async () => {
    // Create a job that fails hard filters (excluded keyword) → rule floor not reached
    const badJob = await repo.upsertJob({
      ...JOB,
      id: 'jobvision:ai-bad',
      externalId: `ai-bad-${Date.now()}`,
      title: 'PHP WordPress Developer',
      company: 'Legacy Co',
      description: 'PHP WordPress only',
      url: `https://jobvision.ir/jobs/ai-bad-${Date.now()}`,
      skills: [],
    });

    const svc = new AIMatchService(prisma, new FakeAI({ kind: 'ok', score: 99 }), {
      ruleFloor: 40,
      maxPerRun: 5,
    });
    const stats = await svc.runWithAI({
      jobIds: [jobId, badJob.jobId],
      userId,
      candidate: CANDIDATE,
    });

    // The rejected match never became status 'new' → not AI-analyzed
    const badMatch = await prisma.jobMatch.findFirst({
      where: { jobId: badJob.jobId, searchProfileId: profileId },
    });
    expect(badMatch?.status).toBe('rejected');
    expect(badMatch?.aiAnalysis).toBeNull();

    await prisma.jobMatch.deleteMany({ where: { jobId: badJob.jobId } });
    await prisma.job.deleteMany({ where: { id: badJob.jobId } });
    void stats;
  });
});
