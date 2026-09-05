/**
 * LinkedIn email-alert ingestion (PROMPT M7 — permitted path only).
 *
 * LinkedIn native Job Alerts send emails to the candidate; Job Hunter reads
 * those emails (the user's own inbox, via IMAP config or an exported mailbox
 * file), extracts job links, and normalizes them. This is NOT scraping:
 * no LinkedIn login, no automated browsing, no anti-bot evasion.
 *
 * The integration is optional: when disabled, the whole system works as-is
 * (see docs/architecture notes and LINKEDIN_ENABLED config flag).
 */

import type { NormalizedJob, RawJobResult, SourceId, SourceListing } from '@job-hunter/core';

/** Senders that LinkedIn uses for job alert emails. */
export const LINKEDIN_ALERT_SENDERS = [
  'jobs-noreply@linkedin.com',
  'updates@linkedin.com',
  'messages-noreply@linkedin.com',
] as const;

export interface LinkedInEmail {
  from: string;
  subject: string;
  /** Raw body (prefer text/plain; HTML tolerated — links extracted). */
  body: string;
  receivedAt?: Date;
}

export interface LinkedInIngestResult {
  listings: SourceListing[];
  /** Job links found but not resolvable to a job id (logged, not fatal). */
  skippedUrls: string[];
}

/** Extract LinkedIn job-posting links from an email body. */
export function extractJobLinks(body: string): string[] {
  const links = new Set<string>();
  // https://www.linkedin.com/jobs/view/1234567890/ or /jobs/view/1234567890?...
  const viewRegex =
    /https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/jobs\/view\/(?:[a-z0-9-]+-)?(\d{5,15})/gi;
  for (const m of body.matchAll(viewRegex)) {
    links.add(`https://www.linkedin.com/jobs/view/${m[1]}/`);
  }
  // Also /jobs/collections/... and /jobs/search?... carry job ids in
  // currentJobId=... parameters
  const searchRegex =
    /https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/jobs\/search[^"'\s]*[?&](?:currentJobId|f_J)=(\d{5,15})/gi;
  for (const m of body.matchAll(searchRegex)) {
    links.add(`https://www.linkedin.com/jobs/view/${m[1]}/`);
  }
  return [...links];
}

/** True when the email looks like a LinkedIn job alert. */
export function isLinkedInAlertEmail(email: LinkedInEmail): boolean {
  const from = email.from.toLowerCase();
  return (
    LINKEDIN_ALERT_SENDERS.some((s) => from.includes(s)) ||
    /new jobs|job alert|jobs for you|recommended jobs/i.test(email.subject)
  );
}

/**
 * Ingest one email: extract job links → listings.
 * Fetching job details from LinkedIn is deliberately NOT attempted: the
 * alert email subject/body already carries the job title/company summary,
 * and the notification links the user straight to LinkedIn. This keeps the
 * integration fully within LinkedIn's permitted alert flow.
 */
export function ingestLinkedInEmail(email: LinkedInEmail): LinkedInIngestResult {
  if (!isLinkedInAlertEmail(email)) return { listings: [], skippedUrls: [] };

  const links = extractJobLinks(email.body);
  const listings: SourceListing[] = links.map((url) => ({
    source: 'linkedin' as SourceId,
    externalId: url.match(/(\d{5,15})\/?$/)?.[1] ?? url,
    url,
    fetchedAt: email.receivedAt ?? new Date(),
  }));

  return { listings, skippedUrls: [] };
}

/**
 * Build a lightweight NormalizedJob from an alert email subject.
 * Example subjects: "New jobs for you: Backend Developer at Acme" or
 * "10 new Backend Engineer jobs in Tehran".
 */
export function normalizeFromAlertSubject(
  subject: string,
  url: string,
  receivedAt?: Date,
): NormalizedJob {
  const cleaned = subject.replace(/^(new jobs? for you|recommended jobs?)[:,]\s*/i, '').trim();
  // "Title at Company" pattern
  const atMatch = /^(.+?)\s+at\s+(.+)$/.exec(cleaned);
  const title = atMatch?.[1] ?? cleaned;
  const company = atMatch?.[2] ?? null;

  return {
    id: `linkedin:${url.match(/(\d{5,15})\/?$/)?.[1] ?? 'unknown'}`,
    source: 'linkedin',
    externalId: url.match(/(\d{5,15})\/?$/)?.[1] ?? url,
    title: title || 'LinkedIn job',
    company: company ?? 'LinkedIn job alert',
    description: subject,
    location: null,
    remote: null,
    employmentType: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: receivedAt ?? null,
    url,
    skills: [],
  };
}

/** Adapter-shaped facade so the pipeline can treat LinkedIn uniformly. */
export interface LinkedInSourceOptions {
  /** Emails ingested since last tick (transport-agnostic; injected). */
  loadEmails: () => Promise<LinkedInEmail[]> | LinkedInEmail[];
}

export class LinkedInAlertSource {
  readonly id: SourceId = 'linkedin';

  constructor(private readonly options: LinkedInSourceOptions) {}

  async search(): Promise<SourceListing[]> {
    const emails = await this.options.loadEmails();
    const listings: SourceListing[] = [];
    for (const email of emails) {
      const result = ingestLinkedInEmail(email);
      listings.push(...result.listings);
    }
    return listings;
  }

  async fetchJob(
    externalId: string,
    context?: { subject?: string; receivedAt?: Date },
  ): Promise<RawJobResult> {
    const url = `https://www.linkedin.com/jobs/view/${externalId}/`;
    return {
      externalId,
      url,
      data: normalizeFromAlertSubject(
        context?.subject ?? 'LinkedIn job alert',
        url,
        context?.receivedAt,
      ),
    };
  }
}
