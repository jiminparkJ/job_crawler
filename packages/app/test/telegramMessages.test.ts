import { describe, expect, it } from 'vitest';
import {
  acknowledgedKeyboard,
  feedbackKeyboard,
  formatMatchMessage,
  formatSalary,
  scoreBar,
  type MatchNotificationData,
} from '../src/telegram/messages.js';

const base: MatchNotificationData = {
  title: 'Backend Engineer',
  company: 'Example Company',
  location: 'Remote',
  remote: 'remote',
  employmentType: 'full_time',
  salary: '45–60 M T',
  url: 'https://jobvision.ir/jobs/123',
  score: 91,
  matchedSkills: ['Node.js', 'TypeScript', 'PostgreSQL'],
  missingSkills: ['Kubernetes'],
  explanation: 'Strong overlap with your experience.',
  sources: ['jobvision'],
};

describe('formatMatchMessage (rich card)', () => {
  it('renders score header with label and meter blockquote', () => {
    const text = formatMatchMessage(base);
    expect(text).toContain('🚀 <b>91%</b>  <i>Strong match</i>');
    expect(text).toContain('<blockquote>▓▓▓▓▓▓▓░ ');
    expect(text).toContain('91%</blockquote>');
  });

  it('renders title bold and company as second identity line', () => {
    const text = formatMatchMessage(base);
    expect(text).toContain('<b>Backend Engineer</b>');
    expect(text).toContain('Example Company');
    expect(text.indexOf('<b>Backend Engineer</b>')).toBeLessThan(text.indexOf('Example Company'));
  });

  it('renders compact facts rows', () => {
    const text = formatMatchMessage(base);
    expect(text).toContain('📍 Remote');
    expect(text).toContain('💼 full time');
    expect(text).toContain('💰 45–60 M T');
  });

  it('renders skills as code chips with check/warn marks', () => {
    const text = formatMatchMessage(base);
    expect(text).toContain('✓ <code>Node.js</code>');
    expect(text).toContain('⚠ <code>Kubernetes</code>');
  });

  it('renders explanation as collapsible blockquote', () => {
    const text = formatMatchMessage(base);
    expect(text).toContain('<blockquote expandable>Strong overlap');
  });

  it('shows multi-source note compactly', () => {
    const text = formatMatchMessage({ ...base, sources: ['jobvision', 'irantalent'] });
    expect(text).toContain('🌐 jobvision + irantalent');
  });

  it('escapes HTML in user data', () => {
    const text = formatMatchMessage({
      ...base,
      company: 'Evil <script>alert(1)</script> & Co',
      title: 'Job <b>title</b>',
    });
    expect(text).not.toContain('<script>');
    expect(text).toContain('&lt;script&gt;');
  });

  it('hides absent sections gracefully', () => {
    const text = formatMatchMessage({
      ...base,
      matchedSkills: [],
      missingSkills: [],
      company: '',
      location: null,
      remote: null,
      employmentType: null,
      salary: null,
      explanation: '',
      sources: ['jobvision'],
    });
    expect(text).not.toContain('📍');
    expect(text).not.toContain('💰');
    expect(text).not.toContain('<code>');
    expect(text).not.toContain('blockquote expandable');
  });

  it('score bands label correctly', () => {
    expect(formatMatchMessage({ ...base, score: 80 })).toContain('Good match');
    expect(formatMatchMessage({ ...base, score: 65 })).toContain('Potential match');
    expect(formatMatchMessage({ ...base, score: 45 })).toContain('Weak match');
  });
});

describe('scoreBar', () => {
  it('fills proportionally', () => {
    expect(scoreBar(100)).toBe('▓▓▓▓▓▓▓▓');
    expect(scoreBar(50)).toBe('▓▓▓▓░░░░');
    expect(scoreBar(0)).toBe('░░░░░░░░');
  });
});

describe('formatSalary', () => {
  it('converts IRR to millions of Tomans with clear unit', () => {
    expect(formatSalary(450_000_000, 600_000_000, 'IRR')).toBe('45–60 M T');
    expect(formatSalary(1_000_000_000, null, 'IRR')).toBe('100+ M T');
    expect(formatSalary(null, 500_000_000, 'IRR')).toBe('≤ 50 M T');
  });

  it('displays half-million values with one decimal', () => {
    expect(formatSalary(455_000_000, null, 'IRR')).toBe('45.5+ M T');
  });

  it('passes through other currencies', () => {
    expect(formatSalary(1000, 2000, 'USD')).toBe('1,000–2,000 USD');
    expect(formatSalary(null, null, null)).toBeNull();
  });
});

describe('feedbackKeyboard', () => {
  it('has Save / Not relevant plus a URL button for the job', () => {
    const kb = feedbackKeyboard('match-1', 'https://jobvision.ir/jobs/1');
    expect(kb.inline_keyboard).toHaveLength(2);
    const [save, notRelevant] = kb.inline_keyboard[0];
    expect(save.callback_data).toBe('save:match-1');
    expect(notRelevant.callback_data).toBe('not_relevant:match-1');
    const [view] = kb.inline_keyboard[1];
    expect(view.url).toBe('https://jobvision.ir/jobs/1');
    expect(view.text).toContain('View job');
  });

  it('works without a URL (no view button)', () => {
    const kb = feedbackKeyboard('match-1');
    expect(kb.inline_keyboard).toHaveLength(1);
  });
});

describe('acknowledgedKeyboard', () => {
  it('keeps the View-job link after feedback', () => {
    const kb = acknowledgedKeyboard('saved', 'https://x/1');
    expect(kb.inline_keyboard[0][0].text).toBe('✓ Saved');
    expect(kb.inline_keyboard[1][0].url).toBe('https://x/1');
  });
});
