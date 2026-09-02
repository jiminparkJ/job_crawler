import { describe, expect, it } from 'vitest';
import { MatchingEngine } from '../src/matching.js';
import type { NormalizedJob, SearchProfile } from '../src/index.js';
import { TerminologyIndex } from '../src/index.js';

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 'job-1',
    source: 'jobvision',
    externalId: '123',
    title: 'Backend Developer',
    company: 'Example Co',
    description:
      'We are hiring a Node.js developer with TypeScript and PostgreSQL experience. Docker and Kubernetes knowledge is a plus.',
    location: 'Tehran',
    remote: null,
    employmentType: 'full_time',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: null,
    url: 'https://jobvision.ir/jobs/123',
    ...overrides,
  };
}

function makeProfile(overrides: Partial<SearchProfile> = {}): SearchProfile {
  return {
    id: 'sp-1',
    userId: 'user-1',
    name: 'Backend Jobs',
    targetTitles: ['Backend Developer', 'Backend Engineer', 'Node.js Developer'],
    requiredKeywords: ['Node.js', 'TypeScript'],
    preferredKeywords: ['PostgreSQL', 'Docker'],
    excludedKeywords: ['PHP', 'WordPress'],
    locations: ['Remote', 'Tehran'],
    employmentTypes: [],
    remotePolicies: [],
    minimumYearsExperience: null,
    minimumMatchScore: 75,
    minSalary: null,
    salaryCurrency: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const engine = new MatchingEngine({ terminology: new TerminologyIndex() });

describe('MatchingEngine', () => {
  it('scores a strong backend job high', () => {
    const r = engine.evaluate(makeJob(), makeProfile());
    expect(r.breakdown.keywordScore).toBeGreaterThan(60);
    expect(r.breakdown.finalScore).toBeGreaterThanOrEqual(85);
    expect(r.recommendation).toBe('strong_match');
    expect(r.hardFilterRejections).toHaveLength(0);
    expect(r.matchedSkills).toContain('PostgreSQL');
    expect(r.matchedSkills).toContain('Docker');
    expect(r.missingSkills).toHaveLength(0);
  });

  it('rejects jobs containing excluded keywords', () => {
    const r = engine.evaluate(
      makeJob({ description: 'PHP and WordPress shop. Node.js also used.' }),
      makeProfile(),
    );
    expect(r.excludedKeywordHits).toContain('PHP');
    expect(r.recommendation).toBe('no_match');
    expect(r.hardFilterRejections.length).toBeGreaterThan(0);
  });

  it('rejects disallowed employment type', () => {
    const r = engine.evaluate(
      makeJob({ employmentType: 'internship' }),
      makeProfile({ employmentTypes: ['full_time'] }),
    );
    expect(r.recommendation).toBe('no_match');
  });

  it('rejects when location does not match', () => {
    const r = engine.evaluate(
      makeJob({ location: 'Shiraz', description: 'Node.js TypeScript role' }),
      makeProfile(),
    );
    expect(r.hardFilterRejections.join(' ')).toMatch(/location/i);
    expect(r.recommendation).toBe('no_match');
  });

  it('accepts remote jobs when remote is wanted', () => {
    const r = engine.evaluate(makeJob({ location: null, remote: 'remote' }), makeProfile());
    expect(r.hardFilterRejections).toHaveLength(0);
  });

  it('recognizes Persian title as equivalent to English target', () => {
    const r = engine.evaluate(
      makeJob({ title: 'برنامه نویس بک اند', description: 'نیاز به تسلط به Node.js و TypeScript' }),
      makeProfile({ locations: [] }),
    );
    expect(r.breakdown.keywordScore).toBeGreaterThan(50);
    expect(r.recommendation).not.toBe('no_match');
  });

  it('rejects salary below minimum', () => {
    const r = engine.evaluate(
      makeJob({ salaryMin: 10, salaryCurrency: 'USD' }),
      makeProfile({ minSalary: 50, salaryCurrency: 'USD', locations: [] }),
    );
    expect(r.hardFilterRejections.join(' ')).toMatch(/salary/i);
  });

  it('produces low score for unrelated jobs', () => {
    const r = engine.evaluate(
      makeJob({
        title: 'UI/UX Designer',
        description: 'Figma, user research, wireframes. No backend work.',
        location: 'Remote',
      }),
      makeProfile(),
    );
    expect(r.breakdown.finalScore).toBeLessThan(75);
  });
});
