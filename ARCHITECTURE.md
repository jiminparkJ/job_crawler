# ARCHITECTURE

## Overview

```
                 ┌────────────────────────────────────────────┐
                 │                  app (Node)                │
                 │                                            │
  JobVision ─────▶│  Source adapters ─▶ NormalizedJob ─▶ Dedup │
  IranTalent ────▶│       (per-source)      (core types)      │
  LinkedIn ──────▶│  (email ingestion, M7, optional)         │
                 │                    │                       │
                 │                    ▼                       │
                 │               Prisma/PostgreSQL            │
                 │        (Job, JobSourceListing, SourceRun) │
                 │                    │                       │
                 │                    ▼                       │
                 │          MatchingEngine (core)             │
                 │     hard filters → keywords → preferences  │
                 │     (+ optional AI provider, M8)           │
                 │                    │                        │
                 │                    ▼                       │
                 │        Telegram notifier (M6) + feedback   │
                 │        (Notification, Feedback)           │
                 │                    │                        │
                 │                    ▼                       │
                 │          Scheduler (restart-safe loop)     │
                 └────────────────────────────────────────────┘
                      Fastify API (/health, future ops UI)
```

## Packages

### `packages/core` — pure domain (no I/O, no framework imports)

- `types.ts` — `NormalizedJob`, `SourceAdapter`, `SourceListing`, `SourceRunStats`, `EmploymentType`, `RemotePolicy`.
- `candidate.ts` — `CandidateProfile` (every item carries `origin: 'explicit' | 'inferred'`), `ExperienceEntry`, `EducationEntry`, `ResumeExtractor` interface.
- `resume/resumeAnalyzer.ts` — heuristic text analysis: contact info, skills (via terminology), titles, experience entries + years estimation, education, languages, locations, inferred seniority. Never invents data; absent info stays `null`/empty.
- `profile.ts` — `SearchProfile` (configurable search criteria: target titles, required/preferred/excluded keywords, locations, employment types, remote policies, salary floor, minimum score).
- `terminology.ts` / `terminologyIndex.ts` — data-driven Persian/English dictionary (titles, skills, locations, employment types, remote policies, seniority, industries). `TerminologyIndex` maps every surface form (normalized) to canonical terms; runtime-extendable, never hardcoded at call sites.
- `text.ts` — Persian-aware normalization: Arabic ي/ك → Persian ی/ک, ZWNJ → space, diacritics strip, digit conversion, lowercase, punctuation collapse, tokenize.
- `matching.ts` — `MatchingEngine.evaluate(job, searchProfile, candidate?)`: excluded-keyword/location/employment/remote/salary hard filters → keyword score (title 60% + required 40%) → preference score → combined final score (semantic weight redistributed when AI absent per PROMPT §11). Pure function.
- `match.ts` — `JobMatchResult`, `JobMatchAnalysis` (AI shape from PROMPT §8), default weights (35/45/20), default threshold 75.
- `dedup.ts` — `canonicalUrl` (tracking-param strip), `contentHash` (order-insensitive sha256), `identityKey` (source:externalId), `logicalKey` (title+company+location).

### `packages/app` — server + persistence + sources

- `config.ts` — zod-validated env (`loadEnv`), feature toggles (`appConfig`): telegram/ai/jobvision/irantalent/linkedin.
- `logger.ts` — pino with secret redaction paths + `maskSecrets` helper. Structured JSON logs in prod, pretty in dev.
- `server.ts` — Fastify factory (`buildApp`/`buildServer`) + `/health` (status, uptime, feature flags, timestamp). `main.ts` — entrypoint with SIGINT/SIGTERM graceful shutdown.
- `prisma/schema.prisma` — models per PROMPT §9: User, CandidateProfile, SearchProfile, JobSource, Job, JobSourceListing, JobMatch, Notification, Feedback, SourceRun. Unique constraints: `(sourceId, externalId)` on Job+Listing, `logicalKey` on Job, `(userId, jobId, channel)` on Notification, `(jobId, searchProfileId)` on JobMatch. Cascades: children of User/Job/SearchProfile. Indexes on hash/title+company+location/score/createdAt.
- Sources (M2+) will implement core's `SourceAdapter` and live in `packages/app/src/sources/<name>/` with fixtures in `packages/app/test/fixtures/<name>/`.

## Key decisions & rationale

- **pnpm workspace, two packages**: core stays dependency-free & pure → fast tests, no mocking of I/O for matching/dedup/terminology.
- **camelCase JobVision API** discovered from the site's own SPA code (PascalCase body returns unfiltered list). Documented in `docs/sources/jobvision.md`.
- **No Playwright for JobVision**: official public JSON API exists; browser automation unnecessary (PROMPT §4 priority order).
- **AI-optional scoring**: `semanticScore: null` redistributes weight to keyword+preference so pre-M8 pipeline is complete and testable (PROMPT §11).
- **Dedup levels** per PROMPT §12: identity key → canonical URL → logical key → content hash; DB enforces first two; logical/content keys computed in core and stored on Job.

## Testing strategy (per PROMPT §15)

- Unit: core matching/terminology/text/dedup/resume — plain Vitest, no I/O.
- Server: Fastify `inject` (no port binding), env via `loadEnv` with test overrides.
- DB integration: gated on `TEST_DATABASE_URL` (skipped otherwise) — full row-graph persistence + unique-constraint checks.
- Sources: recorded JSON fixtures + mocked fetch; network-failure and malformed-data cases mandatory per milestone.
