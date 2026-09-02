import { createHash } from 'node:crypto';
import type { NormalizedJob, SourceId } from './types.js';
import { normalizeForHash, normalizeText } from './text.js';

/**
 * Multi-level duplicate detection (see PROMPT §12):
 *   1. source + external ID
 *   2. canonical URL
 *   3. title + company + location similarity
 *   4. content hash
 */
export function canonicalUrl(source: SourceId, url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Strip common tracking params
    const drop: string[] = [];
    u.searchParams.forEach((_v, k) => {
      if (/^(utm_|ref|source|gclid|fbclid)/i.test(k)) drop.push(k);
    });
    drop.forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url.trim();
  }
}

export function contentHash(
  job: Pick<NormalizedJob, 'title' | 'company' | 'description' | 'location'>,
): string {
  return createHash('sha256')
    .update(
      normalizeForHash(
        `${job.title}|${job.company}|${job.location ?? ''}|${job.description ?? ''}`,
      ),
    )
    .digest('hex');
}

export function identityKey(source: SourceId, externalId: string): string {
  return `${source}:${externalId}`;
}

/**
 * Fuzzy logical-job key: same title+company(+location) ⇒ same logical job.
 */
export function logicalKey(job: Pick<NormalizedJob, 'title' | 'company' | 'location'>): string {
  const loc = job.location ? normalizeText(job.location) : '';
  return createHash('sha1')
    .update(normalizeForHash(`${normalizeText(job.title)}|${normalizeText(job.company)}|${loc}`))
    .digest('hex');
}
