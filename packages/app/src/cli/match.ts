/**
 * CLI: run the matching (and optional personalization/notification) stages
 * immediately, over all active jobs and the user's search profiles.
 *
 * Usage:
 *   pnpm --filter @job-hunter/app match -- <email> [--notify]
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

const root = process.cwd().endsWith('/packages/app')
  ? resolve(process.cwd(), '../..')
  : process.cwd();
config({ path: resolve(root, '.env') });

import { PrismaClient } from '@prisma/client';
import { MatchService } from '../pipeline/matching.js';
import { PersonalizationEngine } from '../personalization/engine.js';
import type { CandidateProfile } from '@job-hunter/core';

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const [email] = argv;
  const notify = argv.includes('--notify');
  if (!email) {
    console.error('Usage: match -- <email> [--notify]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No user with email ${email}`);
      process.exit(1);
    }

    const profileRow = await prisma.candidateProfile.findFirst({
      where: { userId: user.id },
      orderBy: { extractedAt: 'desc' },
    });
    if (!profileRow) {
      console.error('No candidate profile — ingest a resume first.');
      process.exit(1);
    }
    const candidate = profileRow.profile as unknown as CandidateProfile;

    const matcher = new MatchService(prisma);
    const stats = await matcher.runMatching({ userId: user.id, candidate });
    console.log(
      `✓ Matching done: ${stats.jobsConsidered} jobs × ${stats.profilesConsidered} profiles — ` +
        `${stats.matchesPassed} passed, ${stats.matchesRejected} rejected`,
    );

    const pers = new PersonalizationEngine(prisma);
    const { stats: persStats } = await pers.rerank(user.id);
    console.log(
      `✓ Personalization: ${persStats.adjusted} adjusted from ${persStats.signalsConsidered} feedback signals`,
    );

    if (notify) {
      console.log('Notification stage requires TELEGRAM_BOT_TOKEN configured; skipping.');
    }

    const top = await prisma.jobMatch.findMany({
      where: { status: 'new' },
      orderBy: { score: 'desc' },
      take: 10,
      include: { job: { select: { title: true, company: true, location: true } } },
    });
    if (top.length > 0) {
      console.log('\nTop matches:');
      for (const m of top) {
        console.log(
          `  ${String(m.score).padStart(3)}  ${m.job.title} — ${m.job.company} (${m.job.location ?? '?'})`,
        );
      }
    } else {
      console.log('\nNo matches above the profile threshold yet.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Match run failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
