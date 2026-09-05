/**
 * Telegram notification message formatting (PROMPT M6 example format).
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

export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
): string | null {
  if (min == null && max == null) return null;
  const cur = currency === 'IRR' ? 'T' : (currency ?? '');
  const fmt = (v: number) =>
    currency === 'IRR' ? (v / 10_000_000).toString() : v.toLocaleString('en-US');
  const base =
    min != null && max != null
      ? `${fmt(min)}-${fmt(max)}`
      : min != null
        ? `from ${fmt(min)}`
        : `up to ${fmt(max as number)}`;
  return `${base} ${cur}`.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatMatchMessage(data: MatchNotificationData): string {
  const lines: string[] = [];
  lines.push(`🚀 <b>${Math.round(data.score)}% MATCH</b>`);
  lines.push('');
  lines.push(`<b>${escapeHtml(data.title)}</b>`);
  lines.push('');
  if (data.company) lines.push(`🏢 ${escapeHtml(data.company)}`);
  const locParts = [data.location, data.remote === 'remote' ? 'Remote' : null].filter(Boolean);
  if (locParts.length > 0) lines.push(`📍 ${escapeHtml(locParts.join(' · '))}`);
  if (data.employmentType) lines.push(`💼 ${escapeHtml(data.employmentType.replace(/_/g, ' '))}`);
  if (data.salary) lines.push(`💰 ${escapeHtml(data.salary)}`);
  if (data.sources.length > 1) {
    lines.push(`🌐 via ${data.sources.map(escapeHtml).join(', ')}`);
  }
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━');
  if (data.matchedSkills.length > 0) {
    lines.push('MATCHED');
    for (const s of data.matchedSkills.slice(0, 8)) lines.push(`✓ ${escapeHtml(s)}`);
  }
  if (data.missingSkills.length > 0) {
    lines.push('');
    lines.push('POTENTIAL GAPS');
    for (const s of data.missingSkills.slice(0, 5)) lines.push(`⚠ ${escapeHtml(s)}`);
  }
  lines.push('');
  lines.push('WHY');
  lines.push(escapeHtml(data.explanation));
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`<a href="${escapeHtml(data.url)}">🔗 View Job</a>`);
  return lines.join('\n');
}

export function feedbackKeyboard(matchId: string): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return {
    inline_keyboard: [
      [
        { text: '⭐ Save', callback_data: `save:${matchId}` },
        { text: '❌ Not Relevant', callback_data: `not_relevant:${matchId}` },
      ],
    ],
  };
}

/** Keyboard shown after feedback: single disabled-style confirmation chip. */
export function acknowledgedKeyboard(action: 'saved' | 'not_relevant'): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return {
    inline_keyboard: [
      [
        action === 'saved'
          ? { text: '✓ Saved', callback_data: 'noop' }
          : { text: '✗ Marked Not Relevant', callback_data: 'noop' },
      ],
    ],
  };
}
