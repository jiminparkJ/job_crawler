/**
 * CLI: ingest a resume file and (optionally) create the user's search profile.
 *
 * Usage:
 *   pnpm --filter @job-hunter/app ingest -- ./my-resume.pdf you@example.com
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const root = process.cwd().endsWith('/packages/app')
  ? resolve(process.cwd(), '../..')
  : process.cwd();
config({ path: resolve(root, '.env') });

import { PrismaClient } from '@prisma/client';
import { CandidateProfileService } from '../resume/candidateProfileService.js';

async function main() {
  // pnpm run inserts a "--" separator; drop it.
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const [file, email] = args;
  if (!file || !email) {
    console.error('Usage: pnpm --filter @job-hunter/app ingest -- <resume-file> <email>');
    process.exit(1);
  }

  const buffer = await readFile(resolve(root, file));

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });

    const service = new CandidateProfileService(prisma);
    const { profileId, profile } = await service.ingestResume({
      userId: user.id,
      buffer,
      filename: file,
    });

    console.log(`✓ Resume ingested (profile ${profileId})`);
    console.log(`  Name:      ${profile.fullName ?? '—'}`);
    console.log(`  Email:     ${profile.email ?? '—'}`);
    console.log(`  Skills:    ${profile.skills.map((s) => s.value).join(', ') || '—'}`);
    console.log(`  Titles:    ${profile.jobTitles.map((t) => t.value).join(', ') || '—'}`);
    console.log(`  Exp years: ${profile.experienceYears ?? '—'}`);
    console.log(`  Locations: ${profile.locations.map((l) => l.value).join(', ') || '—'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Ingest failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
