import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ProfileBotCommands } from '../src/telegram/profileCommands.js';

const dbUrl = process.env.TEST_DATABASE_URL;
const d = dbUrl ? describe : describe.skip;

d('ProfileBotCommands (Telegram profile configuration)', () => {
  let prisma: PrismaClient;
  let commands: ProfileBotCommands;
  let userId: string;
  let profileId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    commands = new ProfileBotCommands(prisma);
    const user = await prisma.user.create({
      data: { email: `botcmd-${Date.now()}@example.com` },
    });
    userId = user.id;
    const profile = await prisma.searchProfile.create({
      data: {
        userId,
        name: 'Bot Test',
        targetTitles: ['Backend Developer'],
        requiredKeywords: ['Node.js'],
        preferredKeywords: ['Docker'],
        excludedKeywords: ['PHP'],
        locations: ['Tehran'],
        employmentTypes: ['full_time'],
        minimumMatchScore: 60,
      },
    });
    profileId = profile.id;
  });

  afterAll(async () => {
    await prisma.searchProfile.deleteMany({ where: { id: profileId } });
    await prisma.candidateProfile.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const TG_USER = 999;

  it('/help lists commands and fields', async () => {
    const reply = await commands.handle('/help', TG_USER);
    expect(reply).toContain('/profile');
    expect(reply).toContain('/set');
    expect(reply).toContain('/clear');
    expect(reply).toContain('neutral');
  });

  it('/start behaves as help', async () => {
    const reply = await commands.handle('/start', TG_USER);
    expect(reply).toContain('Job Hunter commands');
  });

  it('/profile shows the current configuration', async () => {
    const reply = await commands.handle('/profile', TG_USER);
    expect(reply).toContain('Bot Test');
    expect(reply).toContain('Backend Developer');
    expect(reply).toContain('Node.js');
    expect(reply).toContain('60');
  });

  it('/set replaces a field with comma-separated values (Persian ok)', async () => {
    const reply = await commands.handle(
      '/set titles Backend Developer,برنامه نویس بک اند,Full-Stack Developer',
      TG_USER,
    );
    expect(reply).toContain('✅');
    const p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.targetTitles).toEqual([
      'Backend Developer',
      'برنامه نویس بک اند',
      'Full-Stack Developer',
    ]);
  });

  it('/set excluded updates the hard filter', async () => {
    await commands.handle('/set excluded PHP,WordPress,Game', TG_USER);
    const p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.excludedKeywords).toEqual(['PHP', 'WordPress', 'Game']);
  });

  it('/set minscore validates range', async () => {
    expect(await commands.handle('/set minscore 85', TG_USER)).toContain('85');
    const bad = await commands.handle('/set minscore 150', TG_USER);
    expect(bad).toContain('0–100');
    const p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.minimumMatchScore).toBe(85);
  });

  it('/set with unknown field is rejected', async () => {
    const reply = await commands.handle('/set bogus value', TG_USER);
    expect(reply).toContain('Unknown field');
  });

  it('/set with no value is rejected', async () => {
    const reply = await commands.handle('/set titles', TG_USER);
    expect(reply).toContain('Which value?');
  });

  it('/clear empties a field — empty is NEUTRAL not restrictive', async () => {
    const reply = await commands.handle('/clear excluded', TG_USER);
    expect(reply).toContain('neutral');
    const p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.excludedKeywords).toEqual([]);
    // Engine semantics: empty excluded → nothing is a dealbreaker.
  });

  it('/clear locations accepts every location afterwards', async () => {
    await commands.handle('/clear locations', TG_USER);
    const p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.locations).toEqual([]);
  });

  it('/pause deactivates, /resume reactivates', async () => {
    await commands.handle('/pause', TG_USER);
    let p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.active).toBe(false);

    await commands.handle('/resume', TG_USER);
    p = await prisma.searchProfile.findUnique({ where: { id: profileId } });
    expect(p?.active).toBe(true);
  });

  it('unknown command returns help', async () => {
    const reply = await commands.handle('/frobnicate', TG_USER);
    expect(reply).toContain('Unknown command');
  });

  it('empty-field semantics against the real MatchingEngine', async () => {
    // Verify engine behavior the bot documents: cleared excluded/locations
    // mean no hard-filter rejections from those fields.
    const { MatchingEngine, TerminologyIndex } = await import('@job-hunter/core');
    const engine = new MatchingEngine({ terminology: new TerminologyIndex() });
    const p = await prisma.searchProfile.findUnique({ where: { id: profileId } });

    const job = {
      id: 'x',
      source: 'jobvision' as const,
      externalId: '1',
      title: 'PHP WordPress Developer',
      company: 'X',
      description: 'PHP WordPress in Shiraz',
      location: 'Shiraz',
      remote: null,
      employmentType: 'part_time' as const,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      postedAt: null,
      url: 'https://x/1',
      skills: [],
    };

    const profile = {
      id: p!.id,
      userId: p!.userId,
      name: '',
      targetTitles: p!.targetTitles,
      requiredKeywords: p!.requiredKeywords,
      preferredKeywords: p!.preferredKeywords,
      excludedKeywords: p!.excludedKeywords, // [] after /clear excluded
      locations: p!.locations, // [] after /clear locations
      employmentTypes: [], // cleared: any type passes
      remotePolicies: [],
      minimumYearsExperience: null,
      minimumMatchScore: 0,
      minSalary: null,
      salaryCurrency: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = engine.evaluate(job, profile);
    // Empty excluded → PHP/WordPress not rejected; empty locations → Shiraz ok.
    expect(result.excludedKeywordHits).toEqual([]);
    expect(result.hardFilterRejections).toEqual([]);
    // But scores low (no title match) — neutral ≠ recommended.
    expect(result.breakdown.finalScore).toBeLessThan(60);
  });
});
