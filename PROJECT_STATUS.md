# PROJECT STATUS

Last updated: 2026-09-05 (M1/M2/M3 COMPLETE — verified; next: M4 scheduler → M5 wiring → M6 Telegram)

## Milestones

| Milestone                      | State                  | Notes                                                                                                                                                                                                         |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Foundation                | COMPLETE (verified)    | workspace, TS strict, Fastify, Prisma schema + migration, Docker, env config, logging w/ secret redaction, ESLint+Prettier+Vitest, health endpoint.                                                           |
| M1 — Resume/Candidate profile  | COMPLETE (verified)    | PDF/DOCX/TXT extractors (pdf-parse v2, mammoth) + `CandidateProfileService` DB persistence; 9 extractor tests (binary fixtures) + 5 DB tests; format-parity test proves all 3 formats produce equal profiles. |
| M2 — JobVision                 | COMPLETE (verified)    | Investigation + adapter + fixtures + 19 unit tests; pipeline + repository DB tests. Documented in `docs/sources/jobvision.md`.                                                                                |
| M3 — IranTalent                | COMPLETE (verified)    | SSR-page adapter (embedded JSON extraction), 22 unit tests + pipeline tests incl. source isolation. Documented in `docs/sources/irantalent.md`.                                                               |
| M4 — Unified pipeline          | LARGELY COMPLETE       | JobRepository (4-level dedup), SourceRun recording, both sources isolated + concurrent. Remaining: scheduler + match/notify wiring.                                                                           |
| M5 — Rule matching             | MOSTLY COMPLETE (core) | `MatchingEngine` + tests. Remaining: wire to SearchProfile DB rows + config weights.                                                                                                                          |
| M6 — Telegram                  | PENDING                |                                                                                                                                                                                                               |
| M7 — LinkedIn                  | PENDING                | Email-alert ingestion, optional, never blocking.                                                                                                                                                              |
| M8 — AI matching               | PENDING                | Types defined in core; graceful no-semantic path implemented.                                                                                                                                                 |
| M9 — Personalization/hardening | PENDING                |                                                                                                                                                                                                               |

## Verification evidence

- `pnpm test` — 12 files, 105 tests, all passing (DB integration via TEST_DATABASE_URL, sequential file execution)
- `pnpm lint` — pass; `pnpm -r run typecheck` — pass; `prettier --check .` — pass
- Source isolation verified by test: JobVision failure while IranTalent succeeds
- Dedup verified: source+externalId, canonical URL params, logical key cross-source, content hash
- Resume extraction verified: PDF/DOCX/TXT fixtures produce identical analyzer profiles

## Dev environment

- Postgres container `jobhunter-postgres` (port 5432, user/pass/db `jobhunter`) — start with `docker start jobhunter-postgres` if stopped.
- Tests need `DATABASE_URL` + `TEST_DATABASE_URL` pointing at it.

## Next steps (in order)

1. **M4 finish**: restart-safe scheduler (`POLL_INTERVAL_MINUTES`, skip-if-running guard via SourceRun), `runAllCollections` orchestration entrypoint wired to config (sources enabled via env).
2. **M5 wiring**: match collected jobs against active SearchProfiles; persist JobMatch; threshold from config (default 75).
3. **M6 Telegram**: Bot API sender with retry/pending-Notification persistence, message format per PROMPT, Save/Not-Relevant callback persistence, duplicate-notification prevention.
4. **M7 LinkedIn** (optional email ingestion), **M8 AI provider** (OpenAI + schema-validated output, failure-tolerant), **M9** personalization/hardening.

## Commit history

- `feat: implement project foundation (M0)`
- `feat: add JobVision source (M2) + job persistence/dedup pipeline (M4 core)`
- `feat: add IranTalent source (M3)`
- `feat: complete resume ingestion (M1)` (this commit)
