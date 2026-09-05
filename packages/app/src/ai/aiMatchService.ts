/**
 * AI-augmented matching stage (PROMPT M8):
 * rule score → promising candidates → AI analysis → semantic score → final.
 *
 * Constraints:
 * - NOT every job goes to the AI: only rule-score passers above a floor.
 * - Any AI failure (timeout, rate limit, malformed JSON, provider down)
 *   degrades gracefully to rule-only scoring — never an exception upward.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  DEFAULT_SCORE_WEIGHTS,
  MatchingEngine,
  type AIProvider,
  type CandidateProfile,
  type JobMatchAnalysis,
  type ScoreWeights,
} from '@job-hunter/core';
import { type MatchRunStats } from '../pipeline/matching.js';

export interface AIAssistOptions {
  /** Minimum rule score for a job to be worth AI analysis. */
  ruleFloor: number;
  /** Max jobs sent to the AI per run (cost control). */
  maxPerRun: number;
  /** Score weights (default 35/45/20 keyword/semantic/preference). */
  weights?: ScoreWeights;
}

export const DEFAULT_AI_ASSIST_OPTIONS: AIAssistOptions = {
  ruleFloor: 50,
  maxPerRun: 10,
};

export interface AIAssistStats extends MatchRunStats {
  aiAnalyzed: number;
  aiSkippedLowScore: number;
  aiFailures: number;
}

export class AIMatchService {
  private readonly engine: MatchingEngine;
  private readonly ai: AIProvider;
  private readonly options: AIAssistOptions;

  constructor(
    private readonly prisma: PrismaClient,
    ai: AIProvider,
    options: Partial<AIAssistOptions> = {},
    engine?: MatchingEngine,
  ) {
    this.ai = ai;
    this.options = { ...DEFAULT_AI_ASSIST_OPTIONS, ...options };
    this.engine =
      engine ?? new MatchingEngine({ weights: options.weights ?? DEFAULT_SCORE_WEIGHTS });
  }

  /**
   * Run rule matching, then AI-analyze the most promising matches and blend
   * the semantic score into the final stored score.
   */
  async runWithAI(opts: {
    jobIds?: string[];
    userId?: string;
    candidate: CandidateProfile;
  }): Promise<AIAssistStats> {
    const { MatchService } = await import('../pipeline/matching.js');
    const matchService = new MatchService(this.prisma, this.engine);

    const stats = await matchService.runMatching(opts);
    const aiStats: AIAssistStats = {
      ...stats,
      aiAnalyzed: 0,
      aiSkippedLowScore: 0,
      aiFailures: 0,
    };

    // Promising candidates: newly created matches above the rule floor,
    // ordered by rule score (best first), capped at maxPerRun.
    const promising = await this.prisma.jobMatch.findMany({
      where: {
        status: 'new',
        score: { gte: this.options.ruleFloor },
        ...(opts.userId ? { searchProfile: { userId: opts.userId } } : {}),
        ...(opts.jobIds ? { jobId: { in: opts.jobIds } } : {}),
      },
      orderBy: { score: 'desc' },
      take: this.options.maxPerRun,
      include: { job: true },
    });

    for (const match of promising) {
      const jobRow = match.job;
      const job = {
        id: jobRow.id,
        source: jobRow.sourceId as 'jobvision' | 'irantalent' | 'linkedin',
        externalId: jobRow.externalId,
        title: jobRow.title,
        company: jobRow.company,
        description: jobRow.description,
        location: jobRow.location,
        remote: jobRow.remote as 'remote' | 'hybrid' | 'onsite' | null,
        employmentType: null,
        salaryMin: jobRow.salaryMin,
        salaryMax: jobRow.salaryMax,
        salaryCurrency: jobRow.salaryCurrency,
        postedAt: jobRow.postedAt,
        url: jobRow.canonicalUrl,
        skills: [],
      };

      try {
        const analysis: JobMatchAnalysis = await this.ai.analyzeJobMatch(opts.candidate, job);
        aiStats.aiAnalyzed++;

        // Blend: keyword (already stored breakdown), semantic (AI), preference.
        const weights = this.options.weights ?? DEFAULT_SCORE_WEIGHTS;
        const rulePart = match.score / 100; // stored rule final as keyword proxy
        const semanticPart = analysis.score / 100;
        // We don't have the stored preference sub-score here; approximate the
        // blend by weighting rule vs semantic by their relative weights.
        const total = weights.keyword + weights.semantic + weights.preference;
        const finalScore = Math.round(
          (((weights.keyword + weights.preference) * rulePart + weights.semantic * semanticPart) /
            total) *
            100,
        );

        await this.prisma.jobMatch.update({
          where: { id: match.id },
          data: {
            score: finalScore,
            recommendation: analysis.recommendation,
            matchedSkills: analysis.matchedSkills.length
              ? analysis.matchedSkills
              : match.matchedSkills,
            missingSkills: analysis.missingSkills.length
              ? analysis.missingSkills
              : match.missingSkills,
            explanation: analysis.reasons.length ? analysis.reasons.join('; ') : match.explanation,
            aiAnalysis: analysis as unknown as Prisma.InputJsonValue,
          },
        });
      } catch {
        // AI failure: keep rule-based match untouched. Degrade gracefully.
        aiStats.aiFailures++;
      }
    }

    return aiStats;
  }
}
