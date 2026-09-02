/**
 * Text normalization utilities with Persian/English awareness.
 *
 * Persian-specific handling:
 * - Arabic (ي) vs Persian (ی) ye, Arabic (ك) vs Persian (ک) kaf
 * - Zero-width non-joiner (ZWNJ, U+200C) used extensively in Persian
 * - Arabic diacritics
 */

const ARABIC_YE = /\u064A/g;
const ARABIC_KAF = /\u0643/g;
const ZWNJ = /\u200C/g;
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Convert a single Persian/Arabic digit character to ASCII. */
export function normalizeDigit(ch: string): string {
  const p = PERSIAN_DIGITS.indexOf(ch);
  if (p >= 0) return String(p);
  const a = ARABIC_DIGITS.indexOf(ch);
  if (a >= 0) return String(a);
  return ch;
}

/**
 * Normalize text for comparison:
 * Persian character unification, ZWNJ → space, lowercase, punctuation
 * collapsing, whitespace trimming.
 */
export function normalizeText(input: string): string {
  return input
    .replace(ARABIC_YE, 'ی')
    .replace(ARABIC_KAF, 'ک')
    .replace(ARABIC_DIACRITICS, '')
    .replace(ZWNJ, ' ')
    .toLowerCase()
    .replace(/[.,;:!؟?()[\]{}«»"'/_\\|+—–-]/g, ' ')
    .replace(/[:=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize for hashing/ID purposes: aggressive, order-insensitive token set.
 */
export function normalizeForHash(input: string): string {
  return normalizeText(input)
    .split(' ')
    .filter((t) => t.length > 0)
    .sort()
    .join(' ');
}

/** Extract reasonably sized word tokens for keyword search. */
export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(' ')
    .filter((t) => t.length >= 2);
}
