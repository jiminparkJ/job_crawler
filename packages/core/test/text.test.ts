import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINOLOGY, TerminologyIndex, normalizeText, tokenize } from '../src/index.js';

const terms = new TerminologyIndex();

describe('text normalization', () => {
  it('unifies Persian characters and digits', () => {
    expect(normalizeText('برنامه‌نویس')).toBe('برنامه نویس');
    expect(normalizeText('ي' + 'ك')).toBe('یک');
  });
  it('lowercases and strips punctuation', () => {
    expect(normalizeText('Node.JS / TypeScript!')).toBe('node js typescript');
  });
});

describe('terminology', () => {
  it('recognizes Persian/English backend developer as related', () => {
    expect(terms.areRelated('برنامه نویس بک اند', 'Backend Developer')).toBe(true);
    expect(terms.areRelated('back-end engineer', 'Backend Developer')).toBe(true);
    expect(terms.areRelated('Backend Developer', 'Frontend Developer')).toBe(false);
  });
  it('scans text for skills', () => {
    const hits = terms.scan('We need Node.js, TypeScript and PostgreSQL. آشنایی با داکر', 'skill');
    expect([...hits.keys()]).toContain('node.js');
    expect([...hits.keys()]).toContain('typescript');
    expect([...hits.keys()]).toContain('postgresql');
    expect([...hits.keys()]).toContain('docker');
  });
  it('scans titles with ZWNJ variants', () => {
    const hits = terms.scan('دعوت به همکاری: برنامه‌نویس بک‌اند', 'title');
    expect([...hits.keys()]).toContain('backend_developer');
  });
  it('tokenize produces sane tokens', () => {
    expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
  });
  it('default terminology has no duplicate canonical entries per category', () => {
    const seen = new Set<string>();
    for (const e of DEFAULT_TERMINOLOGY) {
      const key = `${e.category}:${e.canonical}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });
});
