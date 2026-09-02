import type {
  CandidateProfile,
  CandidateProfileItem,
  ExperienceEntry,
  EducationEntry,
} from '../candidate.js';
import { TerminologyIndex } from '../terminologyIndex.js';
import { normalizeText } from '../text.js';

/**
 * Heuristic resume text analyzer. Extracts skills, titles, experience,
 * education, languages, locations and estimates seniority/years of experience.
 *
 * All matches are grounded in the resume text; inferred items (seniority,
 * experience-years) are marked `origin: 'inferred'`.
 */
export class ResumeAnalyzer {
  private readonly terms: TerminologyIndex;

  constructor(terminology?: TerminologyIndex) {
    this.terms = terminology ?? new TerminologyIndex();
  }

  analyze(candidateId: string, text: string): CandidateProfile {
    const lines = text.split(/\r?\n/);
    const profile: CandidateProfile = {
      candidateId,
      fullName: this.extractFullName(lines),
      email: this.extractEmail(text),
      phone: this.extractPhone(text),
      summary: this.extractSummary(lines),
      skills: [],
      jobTitles: [],
      experienceYears: this.estimateYears(text),
      experienceEntries: this.extractExperience(lines),
      education: this.extractEducation(lines),
      languages: this.extractLanguages(text),
      industries: [],
      locations: this.extractLocations(text),
      seniority: this.inferSeniority(text),
      extractedAt: new Date(),
    };

    const skillHits = this.terms.scan(text, 'skill');
    profile.skills = [...skillHits.values()].map((e) => ({
      value: e.canonical,
      origin: 'explicit',
    }));
    profile.jobTitles = [...this.terms.scan(text, 'title').values()].map((e) => ({
      value: e.canonical,
      origin: 'explicit',
    }));
    profile.industries = [...this.terms.scan(text, 'industry').values()].map((e) => ({
      value: e.canonical,
      origin: 'explicit',
    }));
    return profile;
  }

  private extractFullName(lines: string[]): string | null {
    for (const raw of lines.slice(0, 8)) {
      const line = raw.trim();
      if (!line || line.length > 60) continue;
      if (/^[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s'.-]{2,40}$/.test(line)) {
        const words = line.split(/\s+/);
        if (words.length >= 2 && words.length <= 4) return line;
      }
    }
    return null;
  }

  private extractEmail(text: string): string | null {
    const m = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    return m?.[0] ?? null;
  }

  private extractPhone(text: string): string | null {
    const m = text.match(/(\+?\d[\d\s-]{8,14}\d)/);
    return m?.[0].trim() ?? null;
  }

  private extractSummary(lines: string[]): string | null {
    const idx = lines.findIndex((l) => /^(summary|profile|objective|about)/i.test(l.trim()));
    if (idx >= 0 && idx + 1 < lines.length) return lines[idx + 1].trim() || null;
    return null;
  }

  private estimateYears(text: string): number | null {
    const explicit = text.match(/(\d{1,2})\s*\+?\s*(?:years?|سال)/i);
    if (explicit) return Number(explicit[1]);

    // Sum year ranges like 2019 - 2022 / ۱۳۹۸ - ۱۴۰۱
    const yearPairs = [
      ...text.matchAll(
        /(1[39]\d{2}|20\d{2})\s*[-–to]+\s*(1[39]\d{2}|20\d{2}|present|اکنون|تاکنون)/gi,
      ),
    ];
    let total = 0;
    for (const m of yearPairs) {
      const start = Number(m[1]);
      const endRaw = m[2].toLowerCase();
      const end = /present|اکنون|تاکنون/.test(endRaw) ? new Date().getFullYear() : Number(m[2]);
      const d = end - start;
      if (d > 0 && d <= 15) total += d;
    }
    return total > 0 ? Math.min(total, 45) : null;
  }

  private extractExperience(lines: string[]): ExperienceEntry[] {
    const entries: ExperienceEntry[] = [];
    for (const line of lines) {
      const m = line.match(
        /^(.{2,60}?)\s*[-–@|،,]\s*(.{2,50}?)\s*[,،|]?\s*((1[39]\d{2}|20\d{2})\s*[-–to]+\s*(1[39]\d{2}|20\d{2}|present|اکنون|تاکنون).*)?$/i,
      );
      if (!m) continue;
      const [, maybeTitle, maybeCompany, period] = m;
      if (!this.terms.lookup(maybeTitle) && !this.terms.scan(maybeTitle, 'title').size) continue;
      const titleCanon =
        [...this.terms.scan(maybeTitle, 'title').values()][0]?.canonical ?? maybeTitle.trim();
      entries.push({
        title: titleCanon,
        company: maybeCompany?.trim() ?? null,
        startDate: period?.match(/(1[39]\d{2}|20\d{2})/)?.[1] ?? null,
        endDate: period?.match(/[-–to]+\s*(1[39]\d{2}|20\d{2}|present|اکنون|تاکنون)/i)?.[1] ?? null,
        description: null,
      });
    }
    return entries;
  }

  private extractEducation(lines: string[]): EducationEntry[] {
    const entries: EducationEntry[] = [];
    for (const line of lines) {
      const canon = [...this.terms.scan(line, 'title').keys()];
      const isEdu =
        /(b\.?sc|m\.?sc|phd|bachelor|master|diploma|university|دانشگاه|کارشناسی|ارشد|دکتری)/i.test(
          line,
        );
      if (!isEdu) continue;
      const degree =
        line.match(
          /(b\.?sc\.?|m\.?sc\.?|phd|bachelor(?:'s)?|master(?:'s)?|diploma|کارشناسی|کارشناسی ارشد|دکتری)/i,
        )?.[1] ?? null;
      const year = line.match(/(1[39]\d{2}|20\d{2})/)?.[1] ?? null;
      entries.push({
        degree,
        field: null,
        institution:
          line.match(/(?:from|at|دانشگاه)\s+([A-Za-z\u0600-\u06FF\s]{3,40})/)?.[1]?.trim() ?? null,
        year,
      });
      void canon;
    }
    return entries;
  }

  private extractLanguages(text: string): CandidateProfileItem[] {
    const langs = [
      'english',
      'german',
      'french',
      'spanish',
      'arabic',
      'chinese',
      'russian',
      'turkish',
    ];
    const persian = ['انگلیسی', 'آلمانی', 'فرانسوی', 'اسپانیایی', 'عربی', 'چینی', 'روسی', 'ترکی'];
    const norm = normalizeText(text);
    const hits: CandidateProfileItem[] = [];
    langs.forEach((l, i) => {
      if (norm.includes(` ${l} `)) hits.push({ value: l, origin: 'explicit' });
      else if (norm.includes(` ${persian[i]} `)) hits.push({ value: l, origin: 'explicit' });
    });
    return hits;
  }

  private extractLocations(text: string): CandidateProfileItem[] {
    return [...this.terms.scan(text, 'location').values()].map((e) => ({
      value: e.canonical,
      origin: 'explicit' as const,
    }));
  }

  private inferSeniority(text: string): CandidateProfileItem[] {
    const hits = this.terms.scan(text, 'seniority');
    const items: CandidateProfileItem[] = [...hits.values()].map((e) => ({
      value: e.canonical,
      origin: 'inferred',
    }));
    if (items.length === 0 && this.estimateYears(text) != null) {
      items.push({ value: 'mid_level', origin: 'inferred' });
    }
    return items;
  }
}
