/**
 * Telegram notification message formatting.
 *
 * Uses the full Bot API HTML subset: <b>, <i>, <code>, <blockquote>
 * (expandable for long text) — plus URL buttons in the inline keyboard
 * instead of buried text links.
 */

export interface MatchNotificationData {
  title: string;
  company: string;
  location: string | null;
  remote: 'remote' | 'hybrid' | 'onsite' | null;
  employmentType: string | null;
  salary: string | null;
  url: string;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  explanation: string;
  sources: string[];
}

/**
 * Format stored salary (always IRR — Rials) for the Telegram message,
 * displayed in millions of Tomans: "45-60 T" means 45–60 million Tomans.
 */
export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
): string | null {
  if (min == null && max == null) return null;
  // Storage unit: IRR (Rials). 1 million Tomans = 10,000,000 Rials.
  const inTomansMillions = (v: number) => v / 10_000_000;
  const fmt = (v: number) =>
    currency === 'IRR'
      ? Number.isInteger(inTomansMillions(v))
        ? inTomansMillions(v).toString()
        : inTomansMillions(v).toFixed(1)
      : v.toLocaleString('en-US');
  const cur = currency === 'IRR' ? 'M T' : (currency ?? '');
  const base =
    min != null && max != null
      ? `${fmt(min)}–${fmt(max)}`
      : min != null
        ? `${fmt(min)}+`
        : `≤ ${fmt(max as number)}`;
  return `${base} ${cur}`.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Compact visual score meter: ▓▓▓▓▓▓▓░░░ */
export function scoreBar(score: number, width = 8): string {
  const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

function matchLabel(score: number): string {
  if (score >= 85) return 'Strong match';
  if (score >= 75) return 'Good match';
  if (score >= 60) return 'Potential match';
  if (score >= 40) return 'Weak match';
  return 'No match';
}

/** Skill chips rendered as monospace pills, wrapped inline. */
function skillChips(skills: string[], mark: '✓' | '⚠', max: number): string {
  return skills
    .slice(0, max)
    .map((s) => `${mark} <code>${escapeHtml(s)}</code>`)
    .join(' ');
}

export function formatMatchMessage(data: MatchNotificationData): string {
  const score = Math.round(data.score);
  const lines: string[] = [];

  // Header: score + label + meter
  lines.push(`🚀 <b>${score}%</b>  <i>${matchLabel(score)}</i>`);
  lines.push(`<blockquote>${scoreBar(score)} ${score}%</blockquote>`);

  // Job identity
  lines.push(`<b>${escapeHtml(data.title)}</b>`);
  const who = data.company
    .split('\n')
    .map((l) => escapeHtml(l.trim()))
    .filter(Boolean)
    .join(' · ');
  if (who) lines.push(who);

  // Facts row: compact, only present fields
  const facts: string[] = [];
  const locParts = [data.location, data.remote === 'remote' ? 'Remote' : null].filter(Boolean);
  if (locParts.length > 0) facts.push(`📍 ${escapeHtml(locParts.join(' · '))}`);
  if (data.employmentType) facts.push(`💼 ${escapeHtml(data.employmentType.replace(/_/g, ' '))}`);
  if (data.salary) facts.push(`💰 ${escapeHtml(data.salary)}`);
  if (data.sources.length > 1) facts.push(`🌐 ${escapeHtml(data.sources.join(' + '))}`);
  if (facts.length > 0) lines.push(facts.join('\n'));

  // Skills
  const chips: string[] = [];
  if (data.matchedSkills.length > 0) chips.push(skillChips(data.matchedSkills, '✓', 8));
  if (data.missingSkills.length > 0) chips.push(skillChips(data.missingSkills, '⚠', 4));
  if (chips.length > 0) {
    lines.push('');
    lines.push(chips.join('\n'));
  }

  // Why — collapsible blockquote keeps the card clean
  if (data.explanation) {
    lines.push('');
    lines.push(`<blockquote expandable>${escapeHtml(data.explanation)}</blockquote>`);
  }

  return lines.join('\n');
}

/** One keyboard button: either a callback button or a URL button. */
export type KeyboardButton =
  { text: string; callback_data: string } | { text: string; url: string };

export function feedbackKeyboard(
  matchId: string,
  jobUrl?: string,
): {
  inline_keyboard: KeyboardButton[][];
} {
  const rows: KeyboardButton[][] = [
    [
      { text: '⭐ Save', callback_data: `save:${matchId}` },
      { text: '❌ Not relevant', callback_data: `not_relevant:${matchId}` },
    ],
  ];
  if (jobUrl) rows.push([{ text: '🔗 View job posting', url: jobUrl }]);
  return { inline_keyboard: rows };
}

/** Keyboard shown after feedback: confirmation chip + still-linked job. */
export function acknowledgedKeyboard(
  action: 'saved' | 'not_relevant',
  jobUrl?: string,
): {
  inline_keyboard: KeyboardButton[][];
} {
  const rows: KeyboardButton[][] = [
    [
      action === 'saved'
        ? { text: '✓ Saved', callback_data: 'noop' }
        : { text: '✗ Marked not relevant', callback_data: 'noop' },
    ],
  ];
  if (jobUrl) rows.push([{ text: '🔗 View job posting', url: jobUrl }]);
  return { inline_keyboard: rows };
}
