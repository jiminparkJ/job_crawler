import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CandidateProfileService } from '../src/resume/candidateProfileService.js';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'resume');
const pdfBuffer = readFileSync(join(fixtures, 'resume.pdf'));

d('CandidateProfileService', () => {
  let prisma: PrismaClient;
  let service: CandidateProfileService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    service = new CandidateProfileService(prisma);
    const user = await prisma.user.create({
      data: { email: `resume-test-${Date.now()}@example.com` },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.candidateProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => null);
    await prisma.$disconnect();
  });

  it('ingests a PDF resume and persists the structured profile', async () => {
    const { profileId, profile } = await service.ingestResume({
      userId,
      buffer: pdfBuffer,
      filename: 'resume.pdf',
    });

    expect(profileId).toBeTruthy();
    expect(profile.fullName).toBe('Ali Karimi');
    expect(profile.email).toBe('ali.karimi@example.com');
    expect(profile.skills.map((s) => s.value)).toContain('node.js');

    const row = await prisma.candidateProfile.findUnique({ where: { id: profileId } });
    expect(row?.userId).toBe(userId);
    expect(row?.resumeFile).toContain('resume.pdf (pdf)');
    const stored = row?.profile as { skills?: { value: string }[] };
    expect(stored.skills.some((s) => s.value === 'node.js')).toBe(true);
  });

  it('re-ingest replaces the profile (single-profile MVP)', async () => {
    const before = await prisma.candidateProfile.findMany({ where: { userId } });
    expect(before).toHaveLength(1);

    const { profileId } = await service.ingestResume({
      userId,
      buffer: pdfBuffer,
      filename: 'updated.pdf',
    });
    const after = await prisma.candidateProfile.findMany({ where: { userId } });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(profileId);
    expect(after[0].resumeFile).toContain('updated.pdf');
  });

  it('loads the persisted profile back', async () => {
    const profile = await service.getProfile(userId);
    expect(profile?.candidateId).toBe(userId);
    expect(profile?.skills.length).toBeGreaterThan(3);
  });

  it('returns null when user has no profile', async () => {
    const other = await prisma.user.create({
      data: { email: `noresume-${Date.now()}@example.com` },
    });
    expect(await service.getProfile(other.id)).toBeNull();
    await prisma.user.delete({ where: { id: other.id } });
  });

  it('rejects unsupported file formats with a clear error', async () => {
    await expect(
      service.ingestResume({ userId, buffer: Buffer.from('x'), filename: 'img.png' }),
    ).rejects.toThrow(/Unsupported resume format/);
  });
});
