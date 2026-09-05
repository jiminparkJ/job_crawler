# PROJECT STATUS

Last updated: 2026-09-05 (M3 COMPLETE — verified; next: M1 finish → M4 scheduler → M5 wiring)

## Milestones

| Milestone                      | State                  | Notes                                                                                                                                               |
| ------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Foundation                | COMPLETE (verified)    | workspace, TS strict, Fastify, Prisma schema + migration, Docker, env config, logging w/ secret redaction, ESLint+Prettier+Vitest, health endpoint. |
| M1 — Resume/Candidate profile  | MOSTLY COMPLETE        | `ResumeAnalyzer` + 10 tests. Remaining: PDF/DOCX/TXT file-text extraction, wiring to CandidateProfile DB model.                                     |
| M2 — JobVision                 | COMPLETE (verified)    | Investigation + adapter + fixtures + 19 unit tests; pipeline + repository DB tests. Documented in `docs/sources/jobvision.md`.                      |
| M3 — IranTalent                | COMPLETE (verified)    | SSR-page adapter (embedded JSON extraction), 22 unit tests + pipeline tests incl. source isolation. Documented in `docs/sources/irantalent.md`.     |
| M4 — Unified pipeline          | LARGELY COMPLETE       | JobRepository (4-level dedup), SourceRun recording, both sources isolated + concurrent. Remaining: scheduler + match/notify wiring.                 |
| M5 — Rule matching             | MOSTLY COMPLETE (core) | `MatchingEngine` + tests. Remaining: wire to SearchProfile DB rows + config weights.                                                                |
| M6 — Telegram                  | PENDING                |                                                                                                                                                     |
| M7 — LinkedIn                  | PENDING                | Email-alert ingestion, optional, never blocking.                                                                                                    |
| M8 — AI matching               | PENDING                | Types defined in core; graceful no-semantic path implemented.                                                                                       |
| M9 — Personalization/hardening | PENDING                |                                                                                                                                                     |

## Verification evidence

- `pnpm test` — 10 files, 91 tests, all passing (DB integration via TEST_DATABASE_URL, sequential file execution)
- `pnpm lint` — pass; `pnpm -r run typecheck` — pass; `prettier --check .` — pass
- Source isolation verified by test: JobVision failure while IranTalent succeeds
- Dedup verified: source+externalId, canonical URL params, logical key cross-source, content hash

## Dev environment

- Postgres container `jobhunter-postgres` (port 5432, user/pass/db `jobhunter`) — start with `docker start jobhunter-postgres` if stopped.
- Tests need `DATABASE_URL` + `TEST_DATABASE_URL` pointing at it.

## Next steps (in order)

1. **M1 finish**: PDF/DOCX/TXT extractors (pdf-parse, mammoth; TXT direct) → `ResumeAnalyzer.analyze` → persist `CandidateProfile`; tests with generated fixtures.
2. **M4 finish**: restart-safe scheduler (`POLL_INTERVAL_MINUTES`, skip-if-running guard via SourceRun), `runAllCollections` orchestration entrypoint wired to config (sources enabled via env).
3. **M5 wiring**: match collected jobs against active SearchProfiles; persist JobMatch; threshold from config (default 75).
4. **M6 Telegram**: Bot API sender with retry/pending-Notification persistence, message format per PROMPT, Save/Not-Relevant callback persistence, duplicate-notification prevention.
5. **M7 LinkedIn** (optional email ingestion), **M8 AI provider** (OpenAI + schema-validated output, failure-tolerant), **M9** personalization/hardening.

## Commit history

- `feat: implement project foundation (M0)`
- `feat: add JobVision source (M2) + job persistence/dedup pipeline (M4 core)`
- `feat: add IranTalent source (M3)` (this commit)
