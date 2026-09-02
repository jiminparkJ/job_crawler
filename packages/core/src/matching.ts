import type { CandidateProfile } from './candidate.js';
import type { JobMatchResult, MatchBreakdown, ScoreWeights } from './match.js';
import type { SearchProfile } from './profile.js';
import { DEFAULT_SCORE_WEIGHTS } from './match.js';
import type { NormalizedJob } from './types.js';
import { TerminologyIndex } from './terminologyIndex.js';
import { normalizeText, tokenize } from './text.js';

export interface MatchingOptions {
  weights?: ScoreWeights;
  terminology?: TerminologyIndex;
}

/**
 * Rule-based matching engine.
 *
 * Pipeline: hard filters → keyword matching → preference matching → score.
 * The engine is pure: no I/O, no database, no knowledge of sources.
 */
export class MatchingEngine {
  private readonly weights: ScoreWeights;
  private readonly terms: TerminologyIndex;

  constructor(options: MatchingOptions = {}) {
    this.weights = options.weights ?? DEFAULT_SCORE_WEIGHTS;
    this.terms = options.terminology ?? new TerminologyIndex();
  }

  evaluate(
    job: NormalizedJob,
    profile: SearchProfile,
    candidate?: CandidateProfile,
  ): JobMatchResult {
    const haystack = `${job.title} ${job.company} ${job.description ?? ''} ${job.location ?? ''}`;
    const hayNormalized = normalizeText(haystack);
    const hayTokens = new Set(tokenize(haystack));

    const hardFilterRejections: string[] = [];
    const excludedKeywordHits: string[] = [];
    const matchedSkills: string[] = [];
    const missingSkills: string[] = [];

    // --- Hard filter: excluded keywords -------------------------------------
    for (const excluded of profile.excludedKeywords) {
      if (this.phraseInText(excluded, hayNormalized, hayTokens)) {
        excludedKeywordHits.push(excluded);
      }
    }
    if (excludedKeywordHits.length > 0) {
      hardFilterRejections.push(`excluded keywords present: ${excludedKeywordHits.join(', ')}`);
    }

    // --- Hard filter: location ----------------------------------------------
    if (profile.locations.length > 0) {
      const locationOk = this.terms.scan(`${job.location ?? ''} ${job.remote ?? ''}`, 'location');
      const wanted = new Set(
        profile.locations.map((l) => this.terms.lookup(l)?.canonical ?? normalizeText(l)),
      );
      const jobLocations = new Set([...locationOk.keys()]);
      const remoteWanted = wanted.has('remote');
      if (![...wanted].some((w) => jobLocations.has(w))) {
        if (!(remoteWanted && job.remote === 'remote')) {
          hardFilterRejections.push(
            `location ${job.location ?? 'unknown'} not in [${profile.locations.join(', ')}]`,
          );
        }
      }
    }

    // --- Hard filter: employment type ----------------------------------------
    if (profile.employmentTypes.length > 0 && job.employmentType) {
      if (!profile.employmentTypes.includes(job.employmentType)) {
        hardFilterRejections.push(`employment type ${job.employmentType} not allowed`);
      }
    }

    // --- Hard filter: remote policy -------------------------------------------
    if (profile.remotePolicies.length > 0 && job.remote) {
      if (!profile.remotePolicies.includes(job.remote)) {
        hardFilterRejections.push(`remote policy ${job.remote} not allowed`);
      }
    }

    // --- Hard filter: salary ---------------------------------------------------
    if (profile.minSalary != null && (job.salaryMin ?? 0) > 0) {
      const currencyOk =
        !profile.salaryCurrency ||
        !job.salaryCurrency ||
        profile.salaryCurrency === job.salaryCurrency;
      if (currencyOk && (job.salaryMin ?? 0) < profile.minSalary) {
        hardFilterRejections.push(`salary ${job.salaryMin} below minimum ${profile.minSalary}`);
      }
    }

    // --- Keyword score (target titles + required keywords) ---------------------
    const targetTitleCanons = profile.targetTitles.map(
      (t) => this.terms.lookup(t)?.canonical ?? normalizeText(t),
    );
    const titleCanons = [...this.terms.scan(job.title, 'title').keys()];
    const titleHits = targetTitleCanons.filter(
      (tc) => titleCanons.includes(tc) || tc === normalizeText(job.title),
    );

    let requiredHits = 0;
    for (const req of profile.requiredKeywords) {
      if (this.phraseInText(req, hayNormalized, hayTokens)) requiredHits++;
      else missingSkills.push(req);
    }

    const titlePart =
      profile.targetTitles.length > 0 ? titleHits.length / profile.targetTitles.length : 1;
    const reqPart =
      profile.requiredKeywords.length > 0 ? requiredHits / profile.requiredKeywords.length : 1;
    const keywordScore = Math.round(Math.min(1, 0.6 * titlePart + 0.4 * reqPart) * 100);

    // --- Preference score -------------------------------------------------------
    let prefHits = 0;
    const prefMatched: string[] = [];
    for (const pref of profile.preferredKeywords) {
      if (this.phraseInText(pref, hayNormalized, hayTokens)) {
        prefHits++;
        prefMatched.push(pref);
        matchedSkills.push(pref);
      }
    }
    const prefPart =
      profile.preferredKeywords.length > 0 ? prefHits / profile.preferredKeywords.length : 0;
    const preferenceScore = Math.round(prefPart * 100);

    // Candidate-skill overlap adds to preference signal when available.
    if (candidate) {
      const candSkills = new Set(
        candidate.skills.map(
          (s) => this.terms.lookup(s.value)?.canonical ?? normalizeText(s.value),
        ),
      );
      const jobSkills = this.terms.scan(job.description ?? '', 'skill');
      for (const canon of jobSkills.keys()) {
        if (candSkills.has(canon)) matchedSkills.push(canon);
      }
    }

    // --- Final score (semantic absent before M8) --------------------------------
    const semanticScore: number | null = null;
    const finalScore = this.combine(keywordScore, preferenceScore, semanticScore);

    const recommendation =
      hardFilterRejections.length > 0 ? 'no_match' : this.recommendation(finalScore);

    const explanation =
      hardFilterRejections.length > 0
        ? `Rejected by hard filters: ${hardFilterRejections.join('; ')}`
        : `Title match: ${titleHits.length > 0 ? 'yes' : 'no'}. Required keywords matched ${requiredHits}/${profile.requiredKeywords.length}. Preferred matched ${prefHits}/${profile.preferredKeywords.length}.`;

    return {
      jobId: job.id,
      searchProfileId: profile.id,
      breakdown: {
        keywordScore,
        preferenceScore,
        semanticScore,
        finalScore,
      } satisfies MatchBreakdown,
      recommendation,
      matchedSkills: dedupe(matchedSkills),
      missingSkills: dedupe(missingSkills),
      matchedKeywords: dedupe([...titleHits.map(String), ...prefMatched]),
      excludedKeywordHits,
      hardFilterRejections,
      explanation,
      aiAnalysis: null,
    };
  }

  private recommendation(score: number): JobMatchResult['recommendation'] {
    if (score >= 85) return 'strong_match';
    if (score >= 75) return 'good_match';
    if (score >= 60) return 'potential_match';
    if (score >= 40) return 'weak_match';
    return 'no_match';
  }

  /**
   * Combine sub-scores. When semantic score is absent its weight is
   * redistributed proportionally over keyword+preference.
   */
  private combine(
    keywordScore: number,
    preferenceScore: number,
    semanticScore: number | null,
  ): number {
    if (semanticScore == null) {
      const total = this.weights.keyword + this.weights.preference;
      if (total <= 0) return Math.round(0.7 * keywordScore + 0.3 * preferenceScore);
      const wKw = this.weights.keyword / total;
      const wPref = this.weights.preference / total;
      return Math.round(wKw * keywordScore + wPref * preferenceScore);
    }
    return Math.round(
      this.weights.keyword * keywordScore +
        this.weights.semantic * semanticScore +
        this.weights.preference * preferenceScore,
    );
  }

  private phraseInText(phrase: string, normalizedHay: string, hayTokens: Set<string>): boolean {
    const canon = this.terms.lookup(phrase)?.canonical;
    if (canon) {
      const entry = this.terms.allEntries.find((e) => e.canonical === canon);
      if (entry) {
        for (const form of entry.forms) {
          const nf = normalizeText(form);
          if (nf.includes(' ')) {
            if (normalizedHay.includes(nf)) return true;
          } else if (hayTokens.has(nf)) {
            return true;
          }
        }
      }
    }
    const np = normalizeText(phrase);
    if (np.includes(' ')) return normalizedHay.includes(np);
    return hayTokens.has(np);
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
