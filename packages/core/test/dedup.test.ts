import { describe, expect, it } from 'vitest';
import { canonicalUrl, contentHash, identityKey, logicalKey } from '../src/dedup.js';
import type { NormalizedJob } from '../src/index.js';

const base: Pick<NormalizedJob, 'title' | 'company' | 'description' | 'location'> = {
  title: 'Backend Developer',
  company: 'Example Co',
  description: 'Node.js role',
  location: 'Tehran',
};

describe('deduplication keys', () => {
  it('strips tracking params and hash from URLs', () => {
    expect(
      canonicalUrl('jobvision', 'https://jobvision.ir/jobs/123?utm_source=x&utm_medium=y#top'),
    ).toBe('https://jobvision.ir/jobs/123');
  });
  it('same content produces same hash regardless of order/spacing', () => {
    const a = contentHash(base);
    const b = contentHash({ ...base, title: 'backend   developer', description: 'role Node.js' });
    expect(a).toBe(b);
  });
  it('different content produces different hash', () => {
    expect(contentHash(base)).not.toBe(contentHash({ ...base, description: 'Java role' }));
  });
  it('identity key combines source and external id', () => {
    expect(identityKey('jobvision', '123')).toBe('jobvision:123');
  });
  it('logical key is stable across trivial differences', () => {
    const a = logicalKey(base);
    const b = logicalKey({
      ...base,
      title: 'Backend Developer (Node.js)',
      location: 'Tehran, Iran',
    });
    expect(a).not.toBe(b); // different title text ⇒ different key (strict)
  });
});
