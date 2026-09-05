# ARCHITECTURE

## Overview

```
Resume (PDF/DOCX/TXT) ──▶ extract.ts ─▶ ResumeAnalyzer ─▶ CandidateProfile (DB)

SearchProfile (DB) ─── target titles / keywords / locations / threshold

  JobVision ──HTTP──┐
  IranTalent ─SSR───┼─▶ NormalizedJob ─▶ JobRepository ─▶ PostgreSQL
  LinkedIn (email) ─┘      (4-level dedup)     (Job + JobSourceListing + SourceRun)

                              ┌─────────────────────────────────────┐
                              │ Scheduler (restart-safe, skip guard) │
                              └───────────────┬─────────────────────┘
                                              │ tick
                    ┌─────────────────────────▼──────────────────────────┐
                    │ collection (sources isolated; per-job failures      │
                    │ tolerated; SourceRun stats)                        │
                    └─────────────────────────┬──────────────────────────┘
                                              ▼
                       MatchService (hard filters → keyword/preference)
                                              ▼
                    AIMatchService (optional: rule-floor candidates only)
                                              ▼
                    PersonalizationEngine (explainable, bounded deltas)
                                              ▼
                    NotificationService (Telegram; crash-safe; dedup; retry)
                                              ▼
                    Feedback (Save / Not Relevant) ─▶ personalization signals

Fastify: /health · /ops/sources/health · /ops/matches/pending · /ops/matches/:id/status
```

## Packages

### `packages/core` — pure domain (no I/O, no framework imports)

- `types.ts` — `NormalizedJob`, `SourceListing`, `SourceAdapter`, `SourceRunStats`, `EmploymentType`, `RemotePolicy`.
- `candidate.ts` / `profile.ts` — `CandidateProfile` (every item `origin: explicit|inferred`), `SearchProfile`.
- `resume/resumeAnalyzer.ts` — heuristic text analysis; never invents data.
- `terminology.ts` / `terminologyIndex.ts` — runtime-extendable Persian/English dictionary (titles, skills, locations, employment types, remote policies, seniority, industries).
- `text.ts` — Persian-aware normalization (Arabic/Persian char unification, ZWNJ, digits, punctuation collapse).
- `matching.ts` — `MatchingEngine`: hard filters (excluded keywords, location, employment type, remote policy, salary floor) → keyword score (title 60% + required 40%) → preference score → combined score; semantic weight redistributes when AI is off.
- `match.ts` — result types, default weights (35/45/20), threshold 75, recommendation bands.
- `ai.ts` — `AIProvider` interface.
- `dedup.ts` — `canonicalUrl` (tracking-param strip), `contentHash` (order-insensitive sha256), `identityKey`, `logicalKey`.

### `packages/app` — server, persistence, sources, pipeline

- `config.ts` — zod-validated env; feature toggles (`appConfig`).
- `logger.ts` — pino with secret redaction + `maskSecrets`.
- `server.ts` — Fastify factory: health, ops endpoints (source health, pending matches, validated status transitions). `main.ts` boots API + worker with graceful shutdown.
- `prisma/schema.prisma` — models per PROMPT §9 (User, CandidateProfile, SearchProfile, JobSource, Job, JobSourceListing, JobMatch, Notification, Feedback, SourceRun); uniques: `(sourceId, externalId)` on Job+Listing, `logicalKey` on Job, `(userId, jobId, channel)` on Notification, `(jobId, searchProfileId)` on JobMatch; cascades on User/Job/SearchProfile deletes.
- `sources/http.ts` — `HttpClient` abstraction (`requestJson`/`requestText`) + `UndiciHttpClient` (timeout, transient retry, never 4xx-retry). Adapters receive the client (unit-testable, no live network).
- `sources/jobvision/` — public candidate API adapter (camelCase body, numeric sortBy, workType/internship/remote mapping, salary million-Tomans → Rials conversion, HTML stripping, list+detail merge).
- `sources/irantalent/` — SSR-page adapter (brace-matched embedded JSON from `serverSideSearchResult` / `ng-state`; anonymous employers; Rial salaries (IRR); category-slug pagination).
- `sources/linkedin/` — permitted email-alert ingestion: injected `loadEmails()` provider, sender/subject heuristics, job-link extraction, subject-based normalization. No scraping/login/anti-bot handling.
- `resume/` — PDF (pdf-parse v2) / DOCX (mammoth) / TXT extraction with clear errors (scanned/empty/binary); `CandidateProfileService` (ingest → analyze → upsert profile row).
- `repositories/jobRepository.ts` — 4-level dedup in one transaction (source+externalId → canonical URL → logical key → content hash); retains every source listing; `recordSourceRun`.
- `pipeline/collection.ts` — generic run-loop + per-source steps; per-job failures → partial run; search failure → failed run; `runAllCollections` concurrency with isolation.
- `pipeline/matching.ts` — jobs × active SearchProfiles → engine → JobMatch rows; rejects persisted as `rejected`; re-runs preserve user feedback statuses.
- `pipeline/worker.ts` + `startWorker.ts` — config-built tick; stale `running` SourceRuns closed at startup (restart safety).
- `pipeline/scheduler.ts` — interval loop, skip-if-running guard, jitter, crash-tolerant, clean stop.
- `ai/` — `OpenAIProvider` (JSON-mode chat completions; 429/timeout/HTTP → `AIEvaluationError` reasons), `parseAnalysisJson` (fence/prose-tolerant, zod-validated), `DisabledAIProvider`, `AIMatchService` (rule-floor candidates only, capped per run; blends 35/45/20; failure ⇒ rule-only).
- `telegram/` — `TelegramBotClient`, `formatMatchMessage` (PROMPT format, HTML-escaped, IRR→Tomans), `NotificationService` (pending-row-before-send, unique-per-user/job/channel dedup, retry queue, Save/Not-Relevant callbacks → Feedback + JobMatch status).
- `personalization/engine.ts` — feedback signals (company/title saved/rejected, applied momentum) → bounded score deltas with human-readable reasons appended to match explanation; status machine (`MATCH_STATUS_TRANSITIONS`).
- `monitoring/sourceHealth.ts` — 24h per-source aggregates, consecutive failures, healthy verdict.

## Key decisions & rationale

- **core/app split**: pure domain keeps matching/dedup/terminology tests fast and I/O-free; everything touching network/DB lives in app behind injectable interfaces (HttpClient, TelegramClient, AIProvider, loadEmails).
- **No live-site tests**: recorded fixtures for both boards + LinkedIn emails; network-failure and malformed-data cases mandatory per milestone.
- **JobVision camelCase body**: PascalCase bodies are silently ignored by the API (discovered from the site's own SPA) — documented and asserted in tests.
- **IranTalent SSR**: the JSON API 404s external callers; we read the site's own SSR pages (its intended public interface) rather than attempt any bypass.
- **LinkedIn email-only**: strictly the user-configured alert flow; job details are never fetched from LinkedIn itself.
- **AI-optional scoring**: semantic weight redistributes to keyword/preference when AI is off/failing; AI only sees rule-floor-passing candidates (cost control); failures map to explicit reasons.
- **Crash safety**: notifications create a `pending` row before sending; scheduler state lives in SourceRun rows (stale ones closed at startup); all pipeline steps idempotent.
- **Salary units (unified)**: every source stores salaries in **Rials** with `salaryCurrency: 'IRR'` — JobVision's million-Toman values are converted at normalization (× 10,000,000). The Telegram formatter converts IRR→millions of Tomans for display ("45-60 T").

## Testing strategy (PROMPT §15)

23 files / 179 tests:

- Unit: core (text, terminology, matching, resume, dedup), message formatting, AI JSON parsing, scheduler (overlap/crash/jitter/stop).
- Adapter fixture tests: JobVision (19), IranTalent (22), LinkedIn (13), resume extractors (9, incl. format parity).
- DB integration (gated on TEST_DATABASE_URL, sequential): schema graph, repository dedup, collection pipelines (source isolation, idempotency), match service, AI blending/degradation, notifications (dedup/retry/callbacks), personalization, source health, ops endpoints.
- Final acceptance (§18): resume→profile→search→discovery(1 failing source)→normalize→dedup→match→AI→personalization→Telegram→feedback→DB history — 10 steps, all passing.
