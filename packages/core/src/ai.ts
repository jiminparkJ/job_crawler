import type { CandidateProfile } from './candidate.js';
import type { JobMatchAnalysis } from './match.js';
import type { NormalizedJob } from './types.js';

/**
 * Optional AI semantic-matching provider (PROMPT M8).
 * Implementations must be replaceable and failure-tolerant.
 */
export interface AIProvider {
  analyzeJobMatch(candidate: CandidateProfile, job: NormalizedJob): Promise<JobMatchAnalysis>;
}
