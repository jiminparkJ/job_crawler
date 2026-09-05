import { describe, expect, it } from 'vitest';
import {
  AIEvaluationError,
  DisabledAIProvider,
  OpenAIProvider,
  parseAnalysisJson,
} from '../src/ai/provider.js';
import type { HttpClient } from '../src/sources/http.js';

class FakeHttp implements HttpClient {
  calls: { url: string; body?: unknown }[] = [];

  constructor(
    private readonly behavior: {
      status?: number;
      body?: unknown;
      throwMsg?: string;
    } = {},
  ) {}

  requestJson<T>(url: string, options?: { body?: unknown }): Promise<T> {
    this.calls.push({ url, body: options?.body });
    if (this.behavior.throwMsg) return Promise.reject(new Error(this.behavior.throwMsg));
    return Promise.resolve(this.behavior.body as T);
  }

  async requestText(): Promise<string> {
    throw new Error('not used');
  }
}

const VALID_ANALYSIS = {
  score: 87,
  recommendation: 'strong_match',
  matchedSkills: ['Node.js', 'TypeScript'],
  missingSkills: ['Kubernetes'],
  reasons: ['Strong backend experience overlap'],
  concerns: ['Kubernetes is preferred'],
};

describe('parseAnalysisJson', () => {
  it('parses a clean JSON object', () => {
    expect(parseAnalysisJson(JSON.stringify(VALID_ANALYSIS))).toEqual(VALID_ANALYSIS);
  });

  it('parses JSON inside code fences', () => {
    const raw = 'Here is the analysis:\n```json\n' + JSON.stringify(VALID_ANALYSIS) + '\n```';
    expect(parseAnalysisJson(raw)).toEqual(VALID_ANALYSIS);
  });

  it('parses JSON with leading/trailing prose', () => {
    const raw =
      'Sure! {"score": 50, "recommendation": "good_match", "matchedSkills": [], "missingSkills": [], "reasons": [], "concerns": []} hope it helps';
    const parsed = parseAnalysisJson(raw);
    expect(parsed.score).toBe(50);
    expect(parsed.recommendation).toBe('good_match');
  });

  it('rejects invalid JSON with AIEvaluationError', () => {
    expect(() => parseAnalysisJson('not json at all')).toThrow(AIEvaluationError);
    expect(() => parseAnalysisJson('{"score": "high"}')).toThrow(/schema/i);
  });

  it('rejects schema violations (out-of-range score, bad recommendation)', () => {
    expect(() => parseAnalysisJson(JSON.stringify({ ...VALID_ANALYSIS, score: 150 }))).toThrow(
      /schema/i,
    );
    expect(() =>
      parseAnalysisJson(JSON.stringify({ ...VALID_ANALYSIS, recommendation: 'perfect_match' })),
    ).toThrow(/schema/i);
    expect(() =>
      parseAnalysisJson(JSON.stringify({ ...VALID_ANALYSIS, matchedSkills: 'node' })),
    ).toThrow(/schema/i);
  });

  it('rejects empty and fence-only payloads', () => {
    expect(() => parseAnalysisJson('')).toThrow(AIEvaluationError);
    expect(() => parseAnalysisJson('```json\n```')).toThrow(AIEvaluationError);
  });
});

describe('OpenAIProvider', () => {
  const candidate = {
    candidateId: 'c1',
    skills: [],
    jobTitles: [],
    experienceEntries: [],
    education: [],
    languages: [],
    industries: [],
    locations: [],
    seniority: [],
    experienceYears: 8,
    extractedAt: new Date(),
  };
  const job = {
    id: 'jobvision:1',
    source: 'jobvision' as const,
    externalId: '1',
    title: 'Backend',
    company: 'Co',
    description: 'Node.js',
    url: 'https://x/1',
    skills: [],
  };

  it('sends a structured prompt and parses the reply', async () => {
    const http = new FakeHttp({
      body: { choices: [{ message: { content: JSON.stringify(VALID_ANALYSIS) } }] },
    });
    const provider = new OpenAIProvider({ http, apiKey: 'sk-test', model: 'gpt-4o-mini' });

    const analysis = await provider.analyzeJobMatch(candidate, job);
    expect(analysis.score).toBe(87);

    const call = http.calls[0];
    expect(call.url).toContain('/chat/completions');
    const body = call.body as { model: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[1].content).toContain('CANDIDATE PROFILE:');
    expect(body.messages[1].content).toContain('JOB POSTING:');
    expect(body.messages[1].content).toContain('"score"');
  });

  it('maps HTTP 429 to rate_limit AIEvaluationError', async () => {
    const provider = new OpenAIProvider({
      http: new FakeHttp({ throwMsg: 'HTTP 429 for url: too many requests' }),
      apiKey: 'x',
    });
    await expect(provider.analyzeJobMatch(candidate, job)).rejects.toMatchObject({
      reason: 'rate_limit',
    });
  });

  it('maps timeouts to timeout reason', async () => {
    const provider = new OpenAIProvider({
      http: new FakeHttp({ throwMsg: 'This operation was aborted (timeout)' }),
      apiKey: 'x',
    });
    await expect(provider.analyzeJobMatch(candidate, job)).rejects.toMatchObject({
      reason: 'timeout',
    });
  });

  it('maps malformed replies to invalid_response', async () => {
    const provider = new OpenAIProvider({
      http: new FakeHttp({ body: { choices: [{ message: { content: 'garbage' } }] } }),
      apiKey: 'x',
    });
    await expect(provider.analyzeJobMatch(candidate, job)).rejects.toMatchObject({
      reason: 'invalid_response',
    });
  });

  it('maps empty content to invalid_response', async () => {
    const provider = new OpenAIProvider({
      http: new FakeHttp({ body: { choices: [{ message: { content: '' } }] } }),
      apiKey: 'x',
    });
    await expect(provider.analyzeJobMatch(candidate, job)).rejects.toMatchObject({
      reason: 'invalid_response',
    });
  });
});

describe('DisabledAIProvider', () => {
  it('always fails with unavailable reason', async () => {
    const provider = new DisabledAIProvider();
    await expect(provider.analyzeJobMatch({} as never, {} as never)).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });
});
