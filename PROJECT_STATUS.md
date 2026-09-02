# PROJECT STATUS

Last updated: 2026-09-02 (M2 COMPLETE — verified; continuing to M3)

## Milestones

| Milestone                      | State                  | Notes                                                                                                                                                                  |
| ------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Foundation                | COMPLETE (verified)    | workspace, TS strict, Fastify, Prisma schema + migration, Docker, env config, logging w/ secret redaction, ESLint+Prettier+Vitest, health endpoint.                    |
| M1 — Resume/Candidate profile  | MOSTLY COMPLETE        | `ResumeAnalyzer` + 10 tests. Remaining: PDF/DOCX/TXT file-text extraction, wiring to CandidateProfile DB model.                                                        |
| M2 — JobVision                 | COMPLETE (verified)    | Investigation + adapter + fixtures + 19 unit tests; collection pipeline + 4 DB tests; JobRepository dedup + 8 DB tests. Documented in `docs/sources/jobvision.md`.     |
| M3 — IranTalent                | IN PROGRESS (next)     | Investigation not yet done.                                                                                                                                            |
| M4 — Unified pipeline          | LARGELY COMPLETE       | JobRepository (4-level dedup: source+externalId → canonical URL → logical key → content hash), SourceRun recording, source isolation. Remaining: scheduler + matching. |
| M5 — Rule matching             | MOSTLY COMPLETE (core) | `MatchingEngine` + tests. Remaining: wire to SearchProfile DB rows + config weights.                                                                                   |
| M6 — Telegram                  | PENDING                |                                                                                                                                                                        |
| M7 — LinkedIn                  | PENDING                | Email-alert ingestion, optional, never blocking.                                                                                                                       |
| M8 — AI matching               | PENDING                | Types defined in core; graceful no-semantic path implemented.                                                                                                          |
| M9 — Personalization/hardening | PENDING                |                                                                                                                                                                        |

## Verification evidence

- `pnpm test` — 9 files, 66 tests, all passing (DB integration via TEST_DATABASE_URL, sequential file execution to avoid collisions)
- `pnpm lint` — pass; `pnpm -r run typecheck` — pass; `prettier --check .` — pass
- Dedup constraints exercised by tests: source+externalId unique, cross-source logical dedup, canonical-URL param stripping, content-hash fallback

## Dev environment

- Postgres container `jobhunter-postgres` (port 5432, user/pass/db `jobhunter`) — start with `docker start jobhunter-postgres` if stopped.
- Tests need `DATABASE_URL` + `TEST_DATABASE_URL` pointing at it.

## Next steps (M3 — IranTalent)

1. Investigate current IranTalent website: search mechanism, pagination, job URLs/IDs, detail structure, structured data, network requests (same playbook as JobVision: read the site's own JS to find public APIs).
2. Respect access controls; no CAPTCHA/anti-bot bypass (PROMPT §4).
3. Implement `IranTalentSource` in `packages/app/src/sources/irantalent/`, fixtures under `packages/app/test/fixtures/irantalent/`, tests mirroring the JobVision suite, pipeline wiring in `collection.ts`.
4. Then: M4 remainder (scheduler), M5 wiring, M6 Telegram.

## Commit history

- `feat: implement project foundation (M0)` — workspace, server, Prisma, core domain, tests, docs
- `feat: add JobVision source` (M2, this commit)
