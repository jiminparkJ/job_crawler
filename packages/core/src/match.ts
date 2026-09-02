/**
 * Canonical match result produced by the matching engine.
 */
export type MatchRecommendation =
  'strong_match' | 'good_match' | 'potential_match' | 'weak_match' | 'no_match';

export interface MatchBreakdown {
  keywordScore: number;
  preferenceScore: number;
  semanticScore: number | null;
  finalScore: number;
}

export interface JobMatchResult {
  jobId: string;
  searchProfileId: string;
  breakdown: MatchBreakdown;
  recommendation: MatchRecommendation;
  matchedSkills: string[];
  missingSkills: string[];
  matchedKeywords: string[];
  excludedKeywordHits: string[];
  hardFilterRejections: string[];
  explanation: string;
  aiAnalysis?: JobMatchAnalysis | null;
}

export interface JobMatchAnalysis {
  score: number;
  recommendation: MatchRecommendation;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];
  concerns: string[];
}

export interface ScoreWeights {
  keyword: number;
  semantic: number;
  preference: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  keyword: 0.35,
  semantic: 0.45,
  preference: 0.2,
};

export const DEFAULT_MINIMUM_MATCH_SCORE = 75;

export function recommendationFromScore(score: number): MatchRecommendation {
  if (score >= 85) return 'strong_match';
  if (score >= 75) return 'good_match';
  if (score >= 60) return 'potential_match';
  if (score >= 40) return 'weak_match';
  return 'no_match';
}
