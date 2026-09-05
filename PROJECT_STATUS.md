# PROJECT STATUS

Last updated: 2026-09-05 (ALL MILESTONES M0–M9 COMPLETE — verified end-to-end)

## Milestones

| Milestone                      | State               | Notes                                                                                                                                                                             |
| ------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Foundation                | COMPLETE (verified) | workspace, TS strict, Fastify, Prisma schema + migration, Docker, env config, logging w/ secret redaction, ESLint+Prettier+Vitest, health endpoint.                               |
| M1 — Resume/Candidate profile  | COMPLETE (verified) | PDF/DOCX/TXT extractors + CandidateProfileService persistence; format-parity proven by tests.                                                                                     |
| M2 — JobVision                 | COMPLETE (verified) | Public candidate API adapter (camelCase body contract), fixtures + 19 tests. `docs/sources/jobvision.md`.                                                                         |
| M3 — IranTalent                | COMPLETE (verified) | SSR-page adapter (embedded JSON extraction), fixtures + 22 tests. `docs/sources/irantalent.md`.                                                                                   |
| M4 — Unified pipeline          | COMPLETE (verified) | 4-level dedup, SourceRun stats, restart-safe scheduler (skip-if-running, stale-run recovery), worker orchestration, source isolation proven by test.                              |
| M5 — Rule matching             | COMPLETE (verified) | MatchingEngine wired to SearchProfile rows; hard filters, keyword/preference scoring, Persian/English terminology; idempotent JobMatch persistence.                               |
| M6 — Telegram                  | COMPLETE (verified) | Bot client, PROMPT-format messages, crash-safe pending rows, duplicate-notification prevention, Save/Not-Relevant feedback persistence, retry path.                               |
| M7 — LinkedIn                  | COMPLETE (verified) | Permitted email-alert ingestion only (no scraping); optional; system fully functional disabled. `docs/sources/linkedin.md`.                                                       |
| M8 — AI matching               | COMPLETE (verified) | AIProvider abstraction; OpenAI provider with zod-validated JSON; only promising candidates analyzed; every failure mode mapped; graceful degradation to rule-only.                |
| M9 — Personalization/hardening | COMPLETE (verified) | Explainable feedback-based ranking (bounded deltas, readable reasons), match status machine, source health monitoring, ops endpoints (health/sources/matches), graceful shutdown. |

## Final acceptance test (PROMPT §18) — PASSED

`packages/app/test/finalAcceptance.integration.test.ts` (10 steps, all passing):

1. Resume PDF → extracted candidate profile (persisted)
2. Search profile configured (DB row)
3. Discovery via both sources — **with JobVision failing**: source isolation proven, IranTalent succeeds
4. Normalization verified (HTML stripped, IRR salary, remote policy)
5. Re-collection idempotent (all duplicates, no re-notifications)
6. Hard filtering + rule matching → JobMatch persisted (passed + rejected paths)
7. AI matching refines the promising candidate (score blended, analysis persisted)
8. Personalization adjusts ranking with explainable reasons
9. Telegram notification with full format; Save callback persisted (Feedback + status)
10. SourceRun history and source health reflect everything

## Verification evidence

- `pnpm test` — **23 files, 179 tests, all passing** (DB integration via TEST_DATABASE_URL, sequential file execution)
- `pnpm lint` — pass · `pnpm -r run typecheck` — pass · `prettier --check .` — pass
- End-to-end pipeline verified against real PostgreSQL with recorded source fixtures and faked Telegram/AI

## Running it

```bash
docker compose up -d postgres      # or: docker start jobhunter-postgres
cp .env.example .env               # fill TELEGRAM_BOT_TOKEN/CHAT_ID when ready
pnpm --filter @job-hunter/app db:migrate:dev
pnpm dev                           # API + scheduler worker
```

Health: `GET /health` · Source health: `GET /ops/sources/health` · Pending matches: `GET /ops/matches/pending`

Note: **Telegram/AI require user credentials** (bot token, OpenAI key) — genuine external blockers; everything else is functional without them (Telegram sends are skipped/retried, AI stays rule-only).

## Dev environment notes

- Postgres container `jobhunter-postgres` (port 5432, jobhunter/jobhunter/jobhunter).
- Tests need `DATABASE_URL` + `TEST_DATABASE_URL`.
- Live-source smoke tests were used only for investigation; the suite never hits live websites.

## Commit history

- `feat: implement project foundation (M0) + core domain (M1/M4/M5 partials)`
- `feat: add JobVision source (M2) + job persistence/dedup pipeline (M4 core)`
- `feat: add IranTalent source (M3) + unified two-source collection pipeline`
- `feat: complete resume ingestion (M1) — PDF/DOCX/TXT extraction + profile persistence`
- `feat: add restart-safe scheduler and worker orchestration (M4)`
- `feat: wire matching into DB pipeline (M5)`
- `feat: add Telegram notifications with feedback buttons (M6)`
- `feat: add LinkedIn email-alert ingestion (M7, optional permitted path)`
- `feat: add AI semantic matching with provider abstraction (M8)`
- `feat: add personalization, source health, and ops endpoints (M9)`
- `test: final acceptance — end-to-end pipeline verification (M0–M9)`
