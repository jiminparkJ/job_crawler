# Job Hunter

Autonomous job-hunting assistant: collects jobs from Iranian job boards (JobVision, IranTalent) and LinkedIn job-alert emails, normalizes them into one model, deduplicates across sources, matches against a resume-derived candidate profile (rule-based + optional AI semantic matching), and notifies via Telegram with Save / Not Relevant feedback that feeds explainable personalization.

**Status: MVP complete — all milestones M0–M9 implemented, tested (179 tests), and verified end-to-end.**

## Stack

- TypeScript (strict) · Node.js 24 · pnpm workspace
- Fastify (API + health/ops endpoints)
- PostgreSQL + Prisma (migrations in `packages/app/prisma`)
- Vitest (unit + DB integration + fixture-based; never hits live sites in tests)
- ESLint + Prettier
- Docker / docker-compose
- Telegram Bot API
- Optional AI provider (OpenAI-compatible, schema-validated output)

## Repository layout

```
packages/
  core/    # pure domain: types, terminology (Persian/English), text normalization,
           # MatchingEngine, ResumeAnalyzer, dedup keys, AIProvider interface
  app/     # Fastify server, Prisma schema, source adapters, pipeline stages:
           # collection → matching → (AI) → notification, scheduler, personalization,
           # source health; resume extractors (PDF/DOCX/TXT)
docs/sources/   # per-source investigation + implementation docs
PROMPT.md       # original build instructions (M0..M9)
```

## Quick start

```bash
pnpm install
docker compose up -d postgres   # or use your own PostgreSQL
cp .env.example .env            # set DATABASE_URL; add Telegram/AI keys when ready

pnpm --filter @job-hunter/app db:migrate:dev
pnpm dev                        # API + scheduler worker (collect→match→notify)
```

### Endpoints

- `GET /health` — service health + enabled features
- `GET /ops/sources/health` — per-source 24h health (success rate, failures, volumes)
- `GET /ops/matches/pending` — notification queue
- `POST /ops/matches/:id/status` — transitions (`saved`, `not_relevant`, `applied`, `interested`), validated + feedback-persisted

### Tests

```bash
pnpm test          # 23 files, 179 tests (DB integration requires TEST_DATABASE_URL)
pnpm lint && pnpm -r run typecheck && pnpm format:check
```

## How it works

```
Resume (PDF/DOCX/TXT) ──▶ CandidateProfile (explicit vs inferred fields)
SearchProfile (DB)     ──▶ target titles, keywords, locations, threshold

JobVision ─┐
IranTalent ┼─▶ NormalizedJob ─▶ 4-level dedup ─▶ PostgreSQL (Job + listings)
LinkedIn ──┘   (source+externalId → canonical URL → logical key → content hash)
                        │
                        ▼
        Hard filters (excluded keywords, location, type, salary)
                        ▼
        Rule matching (keyword/preference, Persian/English terminology)
                        ▼
        AI semantic score (optional; only promising candidates; failure-safe)
                        ▼
        Personalization (bounded, explainable feedback adjustments)
                        ▼
        Telegram (crash-safe pending rows, duplicate prevention, retry)
                        ▼
        Feedback (Save / Not Relevant) ─▶ personalization signals
```

- **Scheduler**: restart-safe polling (`POLL_INTERVAL_MINUTES`, default 45) with
  skip-if-running guard, jitter, and stale-run recovery from the DB.
- **Source isolation**: a failing source records a failed SourceRun and never
  blocks others (proven by test).
- **LinkedIn**: permitted path only — user-configured Job-Alert emails are
  ingested (no scraping, no login automation). System is fully functional with
  it disabled (default).
- **No secrets in code/logs**: pino redaction + env-validated config.

## Configuration

See `.env.example`. Highlights:

- `DATABASE_URL` — PostgreSQL connection
- `POLL_INTERVAL_MINUTES` — collection cadence (default 45)
- `JOBVISION_ENABLED` / `IRANTALENT_ENABLED` / `LINKEDIN_ENABLED` — source toggles
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — notifications (optional until set)
- `AI_PROVIDER` / `OPENAI_API_KEY` / `AI_MODEL` — semantic matching (optional)

## Notes & limitations

- IranTalent is collected via its public SSR pages (the JSON API rejects
  external callers; no bypass attempted — see `docs/sources/irantalent.md`).
- JobVision uses its public candidate API endpoints discovered from the site's
  own SPA (no auth, no browser automation — `docs/sources/jobvision.md`).
- Telegram credentials and the user's mailbox (for LinkedIn alerts) are genuine
  user-provided values; the pipeline runs without them.
