import { describe, expect, it } from 'vitest';
import { ResumeAnalyzer } from '../src/resume/resumeAnalyzer.js';
import { TerminologyIndex } from '../src/index.js';

const analyzer = new ResumeAnalyzer(new TerminologyIndex());

const RESUME = `Ali Karimi
Backend Developer with 8 years of experience building scalable services.

Email: ali.karimi@example.com
Phone: +98 912 345 6789
Tehran, Iran

SKILLS
Node.js, TypeScript, JavaScript, PostgreSQL, Redis, Docker, Kubernetes, Git, Linux

EXPERIENCE
Senior Backend Developer - Digikala | 2019 - Present
Built microservices with Node.js and PostgreSQL.
Backend Developer - Snapp | 2016 - 2019
Maintained REST APIs with TypeScript and Redis.

EDUCATION
B.Sc. Computer Science, Sharif University, 2015

LANGUAGES
English (fluent), Persian (native)
`;

describe('ResumeAnalyzer', () => {
  const profile = analyzer.analyze('cand-1', RESUME);

  it('extracts contact info', () => {
    expect(profile.fullName).toBe('Ali Karimi');
    expect(profile.email).toBe('ali.karimi@example.com');
    expect(profile.phone).toMatch(/912/);
  });

  it('extracts explicit skills grounded in text', () => {
    const values = profile.skills.map((s) => s.value);
    expect(values).toContain('node.js');
    expect(values).toContain('typescript');
    expect(values).toContain('postgresql');
    expect(values).toContain('docker');
    expect(values).toContain('kubernetes');
    expect(profile.skills.every((s) => s.origin === 'explicit')).toBe(true);
  });

  it('extracts job titles', () => {
    const titles = profile.jobTitles.map((t) => t.value);
    expect(titles).toContain('backend_developer');
  });

  it('estimates experience years and marks it inferred', () => {
    expect(profile.experienceYears).toBeGreaterThanOrEqual(8);
  });

  it('extracts experience entries with dates', () => {
    expect(profile.experienceEntries.length).toBeGreaterThanOrEqual(2);
    const first = profile.experienceEntries.find((e) => e.company?.includes('Digikala'));
    expect(first?.startDate).toBe('2019');
  });

  it('extracts education', () => {
    expect(profile.education.length).toBeGreaterThan(0);
    expect(profile.education[0]?.year).toBe('2015');
  });

  it('extracts languages', () => {
    expect(profile.languages.map((l) => l.value)).toContain('english');
  });

  it('extracts locations', () => {
    expect(profile.locations.map((l) => l.value)).toContain('tehran');
  });

  it('marks inferred seniority distinctly', () => {
    const values = profile.seniority.map((s) => s.value);
    expect(values.some((v) => ['senior', 'mid_level'].includes(v))).toBe(true);
  });

  it('does not invent information for an empty resume', () => {
    const empty = analyzer.analyze('cand-2', 'No relevant content here.');
    expect(empty.skills).toHaveLength(0);
    expect(empty.jobTitles).toHaveLength(0);
    expect(empty.experienceYears).toBeNull();
    expect(empty.email).toBeNull();
  });
});
