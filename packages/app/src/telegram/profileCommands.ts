/**
 * Telegram bot commands for full SearchProfile configuration.
 *
 * Commands:
 *   /help              — list commands
 *   /profile           — show current profile
 *   /set <field> <values...>   — set a field (replaces it)
 *   /clear <field>     — empty a field
 *   /pause | /resume   — toggle profile active
 *
 * Supported fields (comma-separated values, Persian or English):
 *   titles, required, preferred, excluded, locations, types, minscore
 *
 * Empty-field semantics (by design, engine is neutral):
 *   titles empty      → title-match credit is 100% (nothing is penalized)
 *   required empty    → required-keyword credit is 100%
 *   preferred empty   → preference score is 0 (no boost possible)
 *   excluded empty    → no keyword is a dealbreaker
 *   locations empty   → every location passes
 *   types empty       → every employment type passes
 *   minscore 0        → every passing job is notified (max noise)
 */

import { PrismaClient } from '@prisma/client';

export interface BotCommandResult {
  reply: string;
  changed: boolean;
}

/** Field name → SearchProfile column mapping (validated, whitelisted). */
const FIELD_MAP: Record<string, string> = {
  titles: 'targetTitles',
  required: 'requiredKeywords',
  preferred: 'preferredKeywords',
  excluded: 'excludedKeywords',
  locations: 'locations',
  types: 'employmentTypes',
};

const NUMBER_FIELDS = new Set(['minscore']);

const FIELD_LIST = Object.keys(FIELD_MAP)
  .concat([...NUMBER_FIELDS])
  .join(', ');

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const HELP_TEXT = [
  '🤖 <b>Job Hunter commands</b>',
  '',
  '<code>/profile</code> — show your search profile',
  '<code>/set &lt;field&gt; &lt;values&gt;</code> — set a field (replaces old value)',
  '<code>/clear &lt;field&gt;</code> — empty a field',
  '<code>/pause</code> / <code>/resume</code> — stop/start notifications',
  '',
  `Fields: <code>${FIELD_LIST}</code>`,
  'Values are comma-separated; Persian or English both work.',
  '',
  'Examples:',
  '<code>/set titles Backend Developer,برنامه نویس بک اند</code>',
  '<code>/set excluded PHP,WordPress,Game</code>',
  '<code>/set locations Remote,Tehran,تهران</code>',
  '<code>/set minscore 70</code>',
  '<code>/clear excluded</code>',
  '',
  'ℹ️ An empty field is <b>neutral</b>, not restrictive:',
  '• empty excluded → nothing is a dealbreaker',
  '• empty locations → all locations pass',
  '• empty titles/required → no score penalty',
  '• empty preferred → no boost (score from titles/required only)',
].join('\n');

function formatProfile(p: {
  name: string;
  active: boolean;
  targetTitles: string[];
  requiredKeywords: string[];
  preferredKeywords: string[];
  excludedKeywords: string[];
  locations: string[];
  employmentTypes: string[];
  minimumMatchScore: number;
  minSalary: number | null;
}): string {
  const list = (arr: string[]) =>
    arr.length ? arr.map((v) => `• ${v}`).join('\n') : '— (empty = neutral)';
  return [
    `📋 <b>${p.name}</b> ${p.active ? '✅ active' : '⏸ paused'}`,
    '',
    `🎯 <b>Titles</b>\n${list(p.targetTitles)}`,
    `📌 <b>Required</b>\n${list(p.requiredKeywords)}`,
    `⭐ <b>Preferred</b>\n${list(p.preferredKeywords)}`,
    `🚫 <b>Excluded</b>\n${list(p.excludedKeywords)}`,
    `📍 <b>Locations</b>\n${list(p.locations)}`,
    `💼 <b>Types</b>\n${list(p.employmentTypes)}`,
    `🎚 <b>Min score</b>: ${p.minimumMatchScore}`,
    p.minSalary ? `💰 <b>Min salary</b>: ${p.minSalary}` : null,
    '',
    'Change with /set, empty with /clear. /help for usage.',
  ]
    .filter(Boolean)
    .join('\n');
}

export class ProfileBotCommands {
  constructor(private readonly prisma: PrismaClient) {}

  /** Route one command message. Returns the reply text. */
  async handle(rawText: string, _chatUserId: number): Promise<string> {
    const text = rawText.trim();
    const parts = text.split(/\s+/);
    const cmd = (parts[0] ?? '').toLowerCase().replace(/@.*$/, '');

    const user = await this.findUser(_chatUserId);
    if (!user) {
      return '⚠️ No profile found for your chat. Set TELEGRAM_CHAT_ID to your numeric chat id, or run the ingest CLI first.';
    }

    switch (cmd) {
      case '/help':
      case '/start':
        return HELP_TEXT;

      case '/profile': {
        const p = await this.getProfile(user.id);
        return p
          ? formatProfile(p)
          : 'No search profile yet — create one with the profile CLI, then edit it here.';
      }

      case '/pause':
      case '/resume': {
        const active = cmd === '/resume';
        await this.prisma.searchProfile.updateMany({
          where: { userId: user.id },
          data: { active },
        });
        return active ? '▶️ Notifications resumed.' : '⏸ Notifications paused. /resume to restart.';
      }

      case '/set':
        return this.handleSet(parts.slice(1), user.id);

      case '/clear':
        return this.handleClear(parts.slice(1), user.id);

      default:
        return `Unknown command. ${HELP_TEXT}`;
    }
  }

  private async handleSet(args: string[], userId: string): Promise<string> {
    const [fieldRaw, ...rest] = args;
    const field = (fieldRaw ?? '').toLowerCase();
    const value = rest.join(' ').trim();

    if (!field) return `Which field? Fields: <code>${FIELD_LIST}</code>`;
    if (!value) return `Which value? Example: <code>/set ${field} Node.js,TypeScript</code>`;

    const p = await this.getProfile(userId);
    if (!p) return 'No search profile yet — create one with the profile CLI first.';

    if (NUMBER_FIELDS.has(field)) {
      const num = Number(value);
      if (!Number.isInteger(num) || num < 0 || num > 100) {
        return '⚠️ minscore must be an integer 0–100.';
      }
      await this.prisma.searchProfile.update({
        where: { id: p.id },
        data: { minimumMatchScore: num, active: true },
      });
      return `✅ Min score set to <b>${num}</b>.`;
    }

    const column = FIELD_MAP[field];
    if (!column)
      return `⚠️ Unknown field "<code>${field}</code>". Fields: <code>${FIELD_LIST}</code>`;

    const list = parseList(value);
    await this.prisma.searchProfile.update({
      where: { id: p.id },
      data: { [column]: list, active: true },
    });
    return `✅ <b>${field}</b> set to:\n${list.map((v) => `• ${v}`).join('\n')}`;
  }

  private async handleClear(args: string[], userId: string): Promise<string> {
    const field = (args[0] ?? '').toLowerCase();
    if (!field) return `Which field? Fields: <code>${FIELD_LIST}</code> (minscore clears to 0)`;

    const p = await this.getProfile(userId);
    if (!p) return 'No search profile yet — create one with the profile CLI first.';

    if (NUMBER_FIELDS.has(field)) {
      await this.prisma.searchProfile.update({
        where: { id: p.id },
        data: { minimumMatchScore: 0 },
      });
      return '✅ Min score set to 0 (notify every passing job).';
    }

    const column = FIELD_MAP[field];
    if (!column)
      return `⚠️ Unknown field "<code>${field}</code>". Fields: <code>${FIELD_LIST}</code>`;

    await this.prisma.searchProfile.update({ where: { id: p.id }, data: { [column]: [] } });
    return `✅ <b>${field}</b> cleared (empty = neutral, not restrictive).`;
  }

  private async findUser(_chatUserId: number) {
    // Map Telegram user → app user via the search profile owner whose
    // notifications go to the configured chat (single-user MVP: the
    // TELEGRAM_CHAT_ID owner). Falls back to sole active profile.
    const profiles = await this.prisma.searchProfile.findMany({
      select: { id: true, userId: true },
    });
    if (profiles.length === 0) return null;
    if (profiles.length === 1) return { id: profiles[0].userId };
    // Multi-user future: store chatUserId → user mapping. For now take the
    // only user with any profile.
    return { id: profiles[0].userId };
  }

  private async getProfile(userId: string) {
    return this.prisma.searchProfile.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
