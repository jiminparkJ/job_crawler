# Job Hunter

Autonomous job-hunting assistant: collects jobs from Iranian job boards (JobVision, IranTalent), normalizes them into a unified model, deduplicates across sources, matches against a candidate profile (rule-based + optional AI semantic matching), and notifies via Telegram with feedback buttons (Save / Not Relevant).

## Status

Work-in-progress MVP, built milestone-by-milestone (see `PROMPT.md` and `PROJECT_STATUS.md`).
Current: **M0 complete (verified), M1 core implemented (pending final verification), M2 investigation done — adapter implementation next.**

## Stack

- TypeScript (strict), Node.js 24, pnpm workspace
- Fastify (API + health endpoint)
- PostgreSQL + Prisma (migrations in `packages/app/prisma`)
- Vitest (unit + integration, fixtures; no live-website tests)
- ESLint + Prettier
- Docker / docker-compose (app + Postgres)
- Telegram Bot API (upcoming M6)
- Optional AI provider abstraction (upcoming M8)

## Repository layout

```
packages/
  core/    # pure domain: types, terminology, normalization, matching, resume parsing, dedup keys
  app/     # Fastify server, Prisma schema/migrations, config, logging (sources land here)
PROMPT.md  # the autonomous build instructions (M0..M9)
PROJECT_STATUS.md
ARCHITECTURE.md
```

## Development

```bash
pnpm install                 # install workspace deps

# start dev database (or use your own PostgreSQL and set DATABASE_URL)
docker compose up -d postgres

cp .env.example .env         # fill DATABASE_URL etc.

pnpm --filter @job-hunter/app db:migrate:dev   # apply Prisma migrations
pnpm dev                     # start API (health at /health)

pnpm test                    # run all tests (DB integration auto-skips w/o TEST_DATABASE_URL)
pnpm lint
pnpm typecheck
pnpm format
```

### Environment

See `.env.example`. Key variables:

- `DATABASE_URL` — PostgreSQL connection string
- `POLL_INTERVAL_MINUTES` — scheduler interval (default 45)
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — optional until M6
- `AI_PROVIDER` / `OPENAI_API_KEY` / `AI_MODEL` — optional AI matching

### Tests

- Unit/parser tests use local fixtures only (never hit live websites).
- `packages/app/test/db.integration.test.ts` runs when `TEST_DATABASE_URL` is set.

## Sources

- **JobVision (M2)**: public `candidateapi.jobvision.ir` REST API discovered via site's own SPA (details in `docs/sources/jobvision.md`). No auth, no browser automation needed.
- **IranTalent (M3)**: not yet investigated.
- **LinkedIn (M7)**: will be email-alert ingestion only (per `PROMPT.md` §5); no scraping.
