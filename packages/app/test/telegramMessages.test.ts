import { describe, expect, it } from 'vitest';
import {
  feedbackKeyboard,
  formatMatchMessage,
  formatSalary,
  type MatchNotificationData,
} from '../src/telegram/messages.js';

const base: MatchNotificationData = {
  title: 'Backend Engineer',
  company: 'Example Company',
  location: 'Remote',
  remote: 'remote',
  employmentType: 'full_time',
  salary: null,
  url: 'https://jobvision.ir/jobs/123',
  score: 91,
  matchedSkills: ['Node.js', 'TypeScript', 'PostgreSQL'],
  missingSkills: ['Kubernetes'],
  explanation: 'Strong overlap with your experience.',
  sources: ['jobvision'],
};

describe('formatMatchMessage', () => {
  it('renders the PROMPT example format', () => {
    const text = formatMatchMessage(base);
    expect(text).toContain('🚀 <b>91% MATCH</b>');
    expect(text).toContain('<b>Backend Engineer</b>');
    expect(text).toContain('🏢 Example Company');
    expect(text).toContain('📍 Remote');
    expect(text).toContain('💼 full time');
    expect(text).toContain('━━━━━━━━━━━━━━━━');
    expect(text).toContain('MATCHED');
    expect(text).toContain('✓ Node.js');
    expect(text).toContain('POTENTIAL GAPS');
    expect(text).toContain('⚠ Kubernetes');
    expect(text).toContain('WHY');
    expect(text).toContain('Strong overlap with your experience.');
    expect(text).toContain('🔗 View Job');
    expect(text).toContain('href="https://jobvision.ir/jobs/123"');
  });

  it('shows multi-source note when job seen on both sites', () => {
    const text = formatMatchMessage({ ...base, sources: ['jobvision', 'irantalent'] });
    expect(text).toContain('via jobvision, irantalent');
  });

  it('escapes HTML in user data', () => {
    const text = formatMatchMessage({
      ...base,
      company: 'Evil <script>alert(1)</script> & Co',
      title: 'Job <b>title</b>',
    });
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('<b>title</b>');
    expect(text).toContain('&lt;script&gt;');
  });

  it('hides empty sections gracefully', () => {
    const text = formatMatchMessage({
      ...base,
      matchedSkills: [],
      missingSkills: [],
      company: '',
      location: null,
      remote: null,
      employmentType: null,
    });
    expect(text).not.toContain('MATCHED');
    expect(text).not.toContain('POTENTIAL GAPS');
    expect(text).not.toContain('📍');
    expect(text).not.toContain('🏢');
  });
});

describe('formatSalary', () => {
  it('converts IRR (Rials) to millions of Tomans', () => {
    expect(formatSalary(450_000_000, 600_000_000, 'IRR')).toBe('45-60 T');
    expect(formatSalary(1_000_000_000, null, 'IRR')).toBe('from 100 T');
  });

  it('passes through other currencies', () => {
    expect(formatSalary(1000, 2000, 'USD')).toBe('1,000-2,000 USD');
    expect(formatSalary(null, null, null)).toBeNull();
  });
});

describe('feedbackKeyboard', () => {
  it('has Save and Not Relevant buttons with match-scoped callback data', () => {
    const kb = feedbackKeyboard('match-1');
    expect(kb.inline_keyboard).toHaveLength(1);
    const [save, notRelevant] = kb.inline_keyboard[0];
    expect(save.callback_data).toBe('save:match-1');
    expect(notRelevant.callback_data).toBe('not_relevant:match-1');
    expect(save.text).toContain('Save');
    expect(notRelevant.text).toContain('Not Relevant');
  });
});
