# PROJECT STATUS

Last updated: 2026-09-02 (session paused mid-M2; see "Resume notes" at bottom)

## Milestones

| Milestone                      | State                  | Notes                                                                                                                                                                                                                                                                    |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0 — Foundation                | COMPLETE (verified)    | workspace, TS strict, Fastify, Prisma schema + migration applied to dev DB, Docker, env config (zod), pino logging w/ secret redaction, ESLint+Prettier+Vitest, health endpoint. All 35 tests green, lint clean, typechecks pass. Committed.                             |
| M1 — Resume/Candidate profile  | MOSTLY COMPLETE        | Heuristic `ResumeAnalyzer` in `packages/core/src/resume/resumeAnalyzer.ts` with explicit-vs-inferred origins; 10 unit tests over a realistic fixture. Remaining: PDF/DOCX/TXT file-text extraction (only raw-text input currently), wiring to CandidateProfile DB model. |
| M2 — JobVision                 | IN PROGRESS            | Investigation COMPLETE (see `docs/sources/jobvision.md`). Adapter implementation NOT started.                                                                                                                                                                            |
| M3 — IranTalent                | PENDING                | Investigation not yet done.                                                                                                                                                                                                                                              |
| M4 — Unified pipeline          | PENDING                | Core dedup keys (canonicalUrl/contentHash/logicalKey) implemented+tested in core; DB schema has Job/JobSourceListing/unique constraints; pipeline orchestration in app not yet written.                                                                                  |
| M5 — Rule matching             | MOSTLY COMPLETE (core) | `MatchingEngine` (hard filters, keyword/preference scoring, Persian/English terminology via dictionary) implemented + 8 tests. Persian normalization tested. Needs DB wiring + config-driven profiles.                                                                   |
| M6 — Telegram                  | PENDING                |                                                                                                                                                                                                                                                                          |
| M7 — LinkedIn                  | PENDING                | Per PROMPT: email-alert ingestion, optional, never blocking.                                                                                                                                                                                                             |
| M8 — AI matching               | PENDING                | `JobMatchAnalysis`/`AIProvider` types defined in core; graceful no-semantic path already implemented in scoring (weights redistribute).                                                                                                                                  |
| M9 — Personalization/hardening | PENDING                |                                                                                                                                                                                                                                                                          |

## Verification evidence (M0/M1 partial/M5 core)

- `pnpm -r run typecheck` — pass (both packages)
- `pnpm lint` — pass (0 problems)
- `pnpm test` — 6 files, 35 tests, all passing (incl. 2 DB integration tests against Postgres via TEST_DATABASE_URL)
- Prisma migration `20260902064828_init` applied; all 10 tables verified in dev Postgres.

## Current session state (for resuming)

**Dev environment:**

- Postgres container `jobhunter-postgres` (postgres:16-alpine, user/pass/db `jobhunter`, port 5432) was running; may need `docker start jobhunter-postgres` (or `docker compose up -d postgres`) after reboot. All migration state is inside the container volume.

**M2 next steps (investigation already done — DO NOT redo it):**

1. Read `docs/sources/jobvision.md` first — it documents the full API: `POST https://candidateapi.jobvision.ir/api/v1/JobPost/List` (camelCase body: `keyword`, `requestedPage`, `pageSize` max 100?, `sortBy` 0=newest/1=relevance/2=salary, `isRemote`, filters as int-arrays), `GET .../JobPost/Detail?jobPostId=N`, `GET .../JobPost/GetAllSearchFilters`, public job URL `https://jobvision.ir/jobs/{id}`. JobVision list fields are PascalCase (`Query`/`PageNumber`) — camelCase is the correct one (matches the site SPA).
2. Implement `JobVisionSource` adapter in `packages/app/src/sources/jobvision/` following the `SourceAdapter` interface in `packages/core/src/types.ts` (search → SourceListing[]; fetchJob → raw; normalize → NormalizedJob). Use undici (already a dependency), a small fetch wrapper with timeout/retry, and treat HTML `description` (strip tags) + `softwareRequirements[].software.titleEn` as skills.
3. Field mappings discovered: typeId 120=full_time/121=part_time/122=contract-based (project-based); `workType` present in List, absent in Detail (use typeId or carry from list row); seniorityLevel ids 96/97/172/98... ; salary `{min,max,titleEn}` in million Tomans; `activationTime.date` = postedAt; `properties.isRemote` (List) / `isRemote` (Detail); `requiredRelatedExperienceYears`.
4. Fixtures: capture real API JSON shapes (sanitized samples from /tmp/kilo/jv_camel.json and /tmp/kilo/jd_ok.json may be gone — record fresh ones via curl if needed and store under `packages/app/test/fixtures/jobvision/`).
5. Tests: parsing, normalization, malformed data, network failure (mock fetch), missing fields, duplicate jobs — per PROMPT M2 checklist. Update this file + `docs/sources/jobvision.md` as implemented.

**Other pending follow-ups:**

- M1: file extractors (pdf-parse or similar for PDF, mammoth for DOCX, direct read for TXT) feeding `ResumeAnalyzer.analyze`.
- M4: pipeline orchestrator in app package using dedup keys + Prisma upserts, SourceRun recording, source isolation.
- M5: wire MatchingEngine to SearchProfile DB rows; move weights/threshold into config.
- Terminology dictionary may deserve a JSON/TS config file location + loader (currently `DEFAULT_TERMINOLOGY` const in core).

## Commit history (planned)

- `feat: implement project foundation` — M0 (this commit)
