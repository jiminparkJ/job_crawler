/**
 * AI provider abstraction (PROMPT M8).
 *
 * Rule score → promising candidates → AI analysis → semantic score → final
 * score. AI is OPTIONAL: when disabled or failing, the pipeline continues
 * with rule-based scoring only (weights redistribute, see core MatchingEngine).
 */

import { z } from 'zod';
import type { HttpClient } from '../sources/http.js';
import type {
  AIProvider,
  CandidateProfile,
  JobMatchAnalysis,
  NormalizedJob,
} from '@job-hunter/core';

/** Schema-validated AI output shape (PROMPT §8 example). */
const analysisSchema = z.object({
  score: z.number().min(0).max(100),
  recommendation: z.enum([
    'strong_match',
    'good_match',
    'potential_match',
    'weak_match',
    'no_match',
  ]),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  reasons: z.array(z.string()),
  concerns: z.array(z.string()),
});

export class AIEvaluationError extends Error {
  constructor(
    message: string,
    readonly reason: 'timeout' | 'rate_limit' | 'invalid_response' | 'unavailable',
  ) {
    super(message);
    this.name = 'AIEvaluationError';
  }
}

/** Extract the JSON object from an LLM reply (handles code fences). */
export function parseAnalysisJson(raw: string): JobMatchAnalysis {
  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new AIEvaluationError('AI reply contains no JSON object', 'invalid_response');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AIEvaluationError('AI reply is not valid JSON', 'invalid_response');
  }
  const result = analysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new AIEvaluationError(
      `AI reply fails schema: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
      'invalid_response',
    );
  }
  return result.data;
}

function buildPrompt(candidate: CandidateProfile, job: NormalizedJob): string {
  const candSummary = {
    name: candidate.fullName,
    summary: candidate.summary,
    skills: candidate.skills.map((s) => s.value),
    jobTitles: candidate.jobTitles.map((t) => t.value),
    experienceYears: candidate.experienceYears,
    seniority: candidate.seniority.map((s) => s.value),
    locations: candidate.locations.map((l) => l.value),
    languages: candidate.languages.map((l) => l.value),
  };
  const jobSummary = {
    title: job.title,
    company: job.company,
    location: job.location,
    remote: job.remote,
    employmentType: job.employmentType,
    description: job.description.slice(0, 3000),
    skills: job.skills ?? [],
  };
  return [
    'You are a precise job-match analyst. Compare the candidate profile with the job posting.',
    'Respond with ONLY a JSON object, no prose, in exactly this shape:',
    '{"score": <0-100 integer>, "recommendation": "strong_match"|"good_match"|"potential_match"|"weak_match"|"no_match", "matchedSkills": string[], "missingSkills": string[], "reasons": string[], "concerns": string[]}',
    '',
    'CANDIDATE PROFILE:',
    JSON.stringify(candSummary),
    '',
    'JOB POSTING:',
    JSON.stringify(jobSummary),
  ].join('\n');
}

/** OpenAI-compatible chat-completions provider (configurable base URL/model). */
export class OpenAIProvider implements AIProvider {
  private readonly http: HttpClient;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: {
    http: HttpClient;
    apiKey: string;
    model?: string;
    baseUrl?: string;
    timeoutMs?: number;
  }) {
    this.http = opts.http;
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'gpt-4o-mini';
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async analyzeJobMatch(
    candidate: CandidateProfile,
    job: NormalizedJob,
  ): Promise<JobMatchAnalysis> {
    let raw: string;
    try {
      const res = await this.http.requestJson<{ choices?: { message?: { content?: string } }[] }>(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${this.apiKey}` },
          body: {
            model: this.model,
            messages: [
              { role: 'system', content: 'You output only valid JSON matching the given shape.' },
              { role: 'user', content: buildPrompt(candidate, job) },
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' },
          },
          timeoutMs: this.timeoutMs,
          retries: 0, // AI calls: caller decides retries
        },
      );
      raw = res.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/HTTP 429/.test(msg)) throw new AIEvaluationError(msg, 'rate_limit');
      if (/timeout|abort/i.test(msg)) throw new AIEvaluationError(msg, 'timeout');
      throw new AIEvaluationError(msg, 'unavailable');
    }
    return parseAnalysisJson(raw);
  }
}

/** Never-AI provider: semantic score stays null (pre-M8 behavior). */
export class DisabledAIProvider implements AIProvider {
  async analyzeJobMatch(): Promise<JobMatchAnalysis> {
    throw new AIEvaluationError('AI matching is disabled', 'unavailable');
  }
}
