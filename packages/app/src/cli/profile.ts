/**
 * CLI: create/update the user's SearchProfile (job-search criteria, PROMPT §10).
 *
 * Usage:
 *   pnpm --filter @job-hunter/app profile -- <email> <profile-name> \
 *     --titles "Backend Developer,Node.js Developer" \
 *     --required "Node.js,TypeScript" \
 *     --preferred "PostgreSQL,Docker,Redis" \
 *     --excluded "PHP,WordPress" \
 *     --locations "Remote,Tehran" \
 *     --types "full_time" \
 *     --min-score 60
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

const root = process.cwd().endsWith('/packages/app')
  ? resolve(process.cwd(), '../..')
  : process.cwd();
config({ path: resolve(root, '.env') });

import { PrismaClient } from '@prisma/client';

interface CliArgs {
  email: string;
  name: string;
  titles: string[];
  required: string[];
  preferred: string[];
  excluded: string[];
  locations: string[];
  types: string[];
  minScore: number;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const [email, name] = argv;
  if (!email || !name) {
    console.error(
      'Usage: profile -- <email> <name> --titles "..." --required "..." --preferred "..." --excluded "..." --locations "..." --types "..." --min-score N',
    );
    process.exit(1);
  }
  const list = (flag: string): string[] => {
    const i = argv.indexOf(`--${flag}`);
    if (i < 0 || i + 1 >= argv.length) return [];
    return argv[i + 1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };
  const num = (flag: string, dflt: number): number => {
    const i = argv.indexOf(`--${flag}`);
    if (i < 0 || i + 1 >= argv.length) return dflt;
    const v = Number(argv[i + 1]);
    return Number.isFinite(v) ? v : dflt;
  };
  return {
    email,
    name,
    titles: list('titles'),
    required: list('required'),
    preferred: list('preferred'),
    excluded: list('excluded'),
    locations: list('locations'),
    types: list('types'),
    minScore: num('min-score', 75),
  };
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email: args.email } });
    if (!user) {
      console.error(`No user with email ${args.email} — ingest a resume first.`);
      process.exit(1);
    }

    const existing = await prisma.searchProfile.findFirst({
      where: { userId: user.id, name: args.name },
    });

    const data = {
      targetTitles: args.titles,
      requiredKeywords: args.required,
      preferredKeywords: args.preferred,
      excludedKeywords: args.excluded,
      locations: args.locations,
      employmentTypes: args.types,
      remotePolicies: [],
      minimumMatchScore: args.minScore,
      active: true,
    };

    const profile = existing
      ? await prisma.searchProfile.update({ where: { id: existing.id }, data })
      : await prisma.searchProfile.create({ data: { userId: user.id, name: args.name, ...data } });

    console.log(
      `✓ SearchProfile "${profile.name}" ${existing ? 'updated' : 'created'} (${profile.id})`,
    );
    console.log(`  Titles:     ${profile.targetTitles.join(', ') || '—'}`);
    console.log(`  Required:   ${profile.requiredKeywords.join(', ') || '—'}`);
    console.log(`  Preferred:  ${profile.preferredKeywords.join(', ') || '—'}`);
    console.log(`  Excluded:   ${profile.excludedKeywords.join(', ') || '—'}`);
    console.log(`  Locations:  ${profile.locations.join(', ') || '—'}`);
    console.log(`  Types:      ${profile.employmentTypes.join(', ') || 'any'}`);
    console.log(`  Min score:  ${profile.minimumMatchScore}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Profile setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
