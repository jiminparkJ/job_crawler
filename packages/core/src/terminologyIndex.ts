import {
  DEFAULT_TERMINOLOGY,
  type TerminologyCategory,
  type TerminologyEntry,
} from './terminology.js';
import { normalizeText } from './text.js';

/**
 * Searchable terminology index. Maps every surface form (normalized) to its
 * canonical term. The dictionary can be extended/replaced at runtime.
 */
export class TerminologyIndex {
  private index: Map<string, TerminologyEntry[]> = new Map();
  private entries: TerminologyEntry[];

  constructor(entries: TerminologyEntry[] = DEFAULT_TERMINOLOGY) {
    this.entries = entries;
    for (const entry of entries) {
      for (const form of entry.forms) {
        const key = normalizeText(form);
        const bucket = this.index.get(key);
        if (bucket) {
          if (!bucket.some((e) => e.canonical === entry.canonical)) bucket.push(entry);
        } else {
          this.index.set(key, [entry]);
        }
      }
    }
  }

  /** Add or replace terminology at runtime (config-driven, not hardcoded). */
  addEntries(entries: TerminologyEntry[]): void {
    this.entries.push(...entries);
    for (const entry of entries) {
      for (const form of entry.forms) {
        const key = normalizeText(form);
        const bucket = this.index.get(key);
        if (bucket) {
          if (!bucket.some((e) => e.canonical === entry.canonical)) bucket.push(entry);
        } else {
          this.index.set(key, [entry]);
        }
      }
    }
  }

  /** Look up the canonical entry for an exact (normalized) phrase. */
  lookup(phrase: string): TerminologyEntry | undefined {
    const key = normalizeText(phrase);
    const bucket = this.index.get(key);
    return bucket?.[0];
  }

  /** All canonical terms of a category mentioned anywhere in `text`. */
  scan(text: string, category?: TerminologyCategory): Map<string, TerminologyEntry> {
    const haystack = ` ${normalizeText(text)} `;
    const result = new Map<string, TerminologyEntry>();
    for (const [key, bucket] of this.index) {
      for (const entry of bucket) {
        if (category && entry.category !== category) continue;
        if (haystack.includes(` ${key} `)) {
          if (!result.has(entry.canonical)) result.set(entry.canonical, entry);
        }
      }
    }
    return result;
  }

  /** Find all canonical terms appearing in text (any category). */
  scanAll(text: string): Map<string, TerminologyEntry> {
    return this.scan(text);
  }

  /** Check whether two surface phrases map to the same canonical term. */
  areRelated(a: string, b: string): boolean {
    const ea = this.lookup(a);
    const eb = this.lookup(b);
    if (ea && eb) return ea.canonical === eb.canonical;
    return normalizeText(a) === normalizeText(b);
  }

  get allEntries(): readonly TerminologyEntry[] {
    return this.entries;
  }
}
