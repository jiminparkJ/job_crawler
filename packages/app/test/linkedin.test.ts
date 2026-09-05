import { describe, expect, it } from 'vitest';
import {
  extractJobLinks,
  ingestLinkedInEmail,
  isLinkedInAlertEmail,
  normalizeFromAlertSubject,
  LinkedInAlertSource,
  type LinkedInEmail,
} from '../src/sources/linkedin/linkedinSource.js';

const ALERT_EMAIL: LinkedInEmail = {
  from: 'jobs-noreply@linkedin.com',
  subject: 'New jobs for you: Backend Developer at Acme Corp',
  body: `
    Hi Ali, here are new jobs for you.

    Backend Developer at Acme Corp
    https://www.linkedin.com/jobs/view/backend-developer-at-acme-4012345678/?trk=eml_jymbii_...

    Senior Node.js Engineer
    https://www.linkedin.com/jobs/view/4012345679/?eBP=CwUAA...&trk=...

    More results
    https://www.linkedin.com/jobs/search?currentJobId=4012345680&keywords=backend

    You are receiving this email because you set up job alerts.
  `,
  receivedAt: new Date('2026-09-05T08:00:00Z'),
};

describe('isLinkedInAlertEmail', () => {
  it('recognizes official alert senders', () => {
    expect(isLinkedInAlertEmail(ALERT_EMAIL)).toBe(true);
    expect(
      isLinkedInAlertEmail({ from: 'updates@linkedin.com', subject: 'whatever', body: '' }),
    ).toBe(true);
  });

  it('recognizes alert-like subjects from other LinkedIn senders', () => {
    expect(
      isLinkedInAlertEmail({
        from: 'someone@linkedin.com',
        subject: 'New jobs for you: Backend Engineer in Tehran',
        body: '',
      }),
    ).toBe(true);
  });

  it('rejects non-LinkedIn email', () => {
    expect(isLinkedInAlertEmail({ from: 'spam@example.com', subject: 'Buy now', body: '' })).toBe(
      false,
    );
  });
});

describe('extractJobLinks', () => {
  it('extracts canonical job ids from view URLs', () => {
    const links = extractJobLinks(ALERT_EMAIL.body);
    expect(links).toContain('https://www.linkedin.com/jobs/view/4012345678/');
    expect(links).toContain('https://www.linkedin.com/jobs/view/4012345679/');
    expect(links).toContain('https://www.linkedin.com/jobs/view/4012345680/');
    expect(links).toHaveLength(3);
  });

  it('deduplicates repeated links', () => {
    const links = extractJobLinks(
      'https://www.linkedin.com/jobs/view/111111111/?a=1 https://www.linkedin.com/jobs/view/111111111/?b=2',
    );
    expect(links).toHaveLength(1);
  });

  it('handles localized linkedin domains', () => {
    const links = extractJobLinks('https://ir.linkedin.com/jobs/view/2222222222/');
    expect(links).toContain('https://www.linkedin.com/jobs/view/2222222222/');
  });

  it('returns empty for bodies without job links', () => {
    expect(extractJobLinks('just text, no links')).toEqual([]);
  });
});

describe('ingestLinkedInEmail', () => {
  it('produces listings from an alert email', () => {
    const result = ingestLinkedInEmail(ALERT_EMAIL);
    expect(result.listings).toHaveLength(3);
    expect(result.listings[0]).toMatchObject({ source: 'linkedin' });
    expect(result.listings[0].externalId).toBe('4012345678');
    expect(result.listings[0].url).toBe('https://www.linkedin.com/jobs/view/4012345678/');
    expect(result.listings[0].fetchedAt).toEqual(ALERT_EMAIL.receivedAt);
  });

  it('ignores non-alert emails entirely', () => {
    const result = ingestLinkedInEmail({
      from: 'friend@example.com',
      subject: 'lunch?',
      body: 'https://www.linkedin.com/jobs/view/3333333333/',
    });
    expect(result.listings).toEqual([]);
  });
});

describe('normalizeFromAlertSubject', () => {
  it('extracts title and company from "Title at Company" subjects', () => {
    const job = normalizeFromAlertSubject(
      'New jobs for you: Backend Developer at Acme Corp',
      'https://www.linkedin.com/jobs/view/4012345678/',
      new Date('2026-09-05T08:00:00Z'),
    );
    expect(job.title).toBe('Backend Developer');
    expect(job.company).toBe('Acme Corp');
    expect(job.source).toBe('linkedin');
    expect(job.externalId).toBe('4012345678');
    expect(job.postedAt?.toISOString()).toBe('2026-09-05T08:00:00.000Z');
  });

  it('falls back to whole-subject title when no "at" pattern', () => {
    const job = normalizeFromAlertSubject(
      '10 new Backend Engineer jobs in Tehran',
      'https://www.linkedin.com/jobs/view/9999999999/',
    );
    expect(job.title).toBe('10 new Backend Engineer jobs in Tehran');
    expect(job.company).toBe('LinkedIn job alert');
  });
});

describe('LinkedInAlertSource', () => {
  it('searches via injected emails and fetches by id', async () => {
    const source = new LinkedInAlertSource({ loadEmails: () => [ALERT_EMAIL] });
    const listings = await source.search();
    expect(listings).toHaveLength(3);

    const raw = await source.fetchJob('4012345678', {
      subject: 'New jobs for you: Backend Developer at Acme Corp',
      receivedAt: ALERT_EMAIL.receivedAt,
    });
    const job = raw.data as ReturnType<typeof normalizeFromAlertSubject>;
    expect(job.company).toBe('Acme Corp');
  });

  it('returns empty when no emails / non-alert emails', async () => {
    const empty = new LinkedInAlertSource({ loadEmails: () => [] });
    expect(await empty.search()).toEqual([]);
    const spam = new LinkedInAlertSource({
      loadEmails: () => [{ from: 'x@example.com', subject: 'hi', body: '' }],
    });
    expect(await spam.search()).toEqual([]);
  });
});
