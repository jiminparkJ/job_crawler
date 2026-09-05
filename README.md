# Job Hunter

Autonomous job-hunting assistant: collects jobs from Iranian job boards (JobVision, IranTalent) and LinkedIn job-alert emails, normalizes them into one model, deduplicates across sources, matches them against your resume-derived profile (rule-based + optional AI), and sends matches to Telegram with Save / Not-Relevant buttons whose feedback personalizes future rankings.

**Stack:** TypeScript (strict) · Node.js 24 · pnpm workspace · Fastify · PostgreSQL + Prisma · Vitest (186 tests) · Docker · Telegram Bot API

---

## Table of contents

1. [What it does](#1-what-it-does)
2. [Prerequisites](#2-prerequisites)
3. [One-time setup](#3-one-time-setup)
4. [Configure the environment](#4-configure-the-environment)
5. [Set up the database](#5-set-up-the-database)
6. [Create your Telegram bot](#6-create-your-telegram-bot)
7. [Run the app](#7-run-the-app)
8. [Feed in your data](#8-feed-in-your-data)
9. [Verify everything works](#9-verify-everything-works)
10. [Day-to-day usage](#10-day-to-day-usage)
11. [All CLI commands](#11-all-cli-commands)
12. [Viewing the database](#12-viewing-the-database)
13. [Testing](#13-testing)
14. [How the pipeline works](#14-how-the-pipeline-works)
15. [Troubleshooting](#15-troubleshooting)
16. [Deployment (production)](#16-deployment-production)

---

## 1. What it does

Every 45 minutes (configurable), the app automatically runs:

```
collect (JobVision + IranTalent) → normalize → dedup (4 levels) →
match against YOUR search profile → personalization (your feedback) →
Telegram notification with ⭐ Save / ❌ Not Relevant buttons
```

When you press a button: feedback is stored, the message's buttons change to
`✓ Saved` / `✗ Marked Not Relevant`, and future rankings adjust (jobs from
companies/titles you saved get boosted, rejected ones get penalized).

LinkedIn is optional: if you configure LinkedIn job-alert emails to be ingested
(transport-agnostic), those jobs enter the same pipeline. The system is fully
functional without it.

---

## 2. Prerequisites

| Tool    | Version              | Check with         |
| ------- | -------------------- | ------------------ |
| Node.js | 20+ (24 recommended) | `node --version`   |
| pnpm    | 9+                   | `pnpm --version`   |
| Docker  | any recent           | `docker --version` |
| Git     | any                  | `git --version`    |

A Telegram account (for the bot) is needed only for notifications — everything
else works without it.

---

## 3. One-time setup

```bash
# 1. Clone / open the project
cd /workspaces/job_crawler        # adjust to your path

# 2. Install all workspace dependencies
pnpm install

# 3. Start PostgreSQL (dev database)
docker compose up -d postgres
# wait ~10 seconds, then confirm it's ready:
docker exec jobhunter-postgres pg_isready -U jobhunter
# → "/var/run/postgresql:5432 - accepting connections"
```

> If port 5432 is already used by another Postgres, change `POSTGRES_PORT` in
> `.env` and the port mapping in `docker-compose.yml`.

## 4. Configure the environment

```bash
cp .env.example .env
```

Open `.env` and set the values. Line by line:

| Variable                                      | Default       | What to set                                          |
| --------------------------------------------- | ------------- | ---------------------------------------------------- |
| `PORT`                                        | `3000`        | API port. Keep default.                              |
| `LOG_LEVEL`                                   | `info`        | `debug` when investigating, `warn` for quieter logs. |
| `NODE_ENV`                                    | `development` | `production` when deploying.                         |
| `DATABASE_URL`                                | (set below)   | Must point at your Postgres.                         |
| `POLL_INTERVAL_MINUTES`                       | `45`          | How often the pipeline runs (min 5).                 |
| `TELEGRAM_BOT_TOKEN`                          | empty         | From @BotFather — see §6.                            |
| `TELEGRAM_CHAT_ID`                            | empty         | Your chat id — see §6.                               |
| `AI_PROVIDER` / `OPENAI_API_KEY` / `AI_MODEL` | empty         | Optional AI ranking.                                 |
| `JOBVISION_ENABLED`                           | `true`        | Set `false` to disable that source.                  |
| `IRANTALENT_ENABLED`                          | `true`        | Set `false` to disable that source.                  |

For the local docker Postgres, use exactly:

```
DATABASE_URL=postgresql://jobhunter:jobhunter@localhost:5432/jobhunter?schema=public
```

## 5. Set up the database

```bash
# 1. Create the schema (applies the migration)
DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter?schema=public" \
  pnpm --filter @job-hunter/app exec prisma migrate deploy

# 2. Also create the ISOLATED test database (one-time — tests wipe their data,
#    so they must NEVER run against your real database)
docker exec jobhunter-postgres psql -U jobhunter -c "CREATE DATABASE jobhunter_test OWNER jobhunter;"
DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter_test?schema=public" \
  pnpm --filter @job-hunter/app exec prisma migrate deploy

# 3. Verify: both databases show the 10 tables
docker exec jobhunter-postgres psql -U jobhunter -d jobhunter -c "\dt"
```

You should see: CandidateProfile, Feedback, Job, JobMatch, JobSource,
JobSourceListing, Notification, SearchProfile, SourceRun, User.

## 6. Create your Telegram bot

1. Open Telegram, search **@BotFather**, send `/newbot`.
2. Give it a name (e.g. `My Job Hunter`) and a username ending in `bot`.
3. BotFather replies with a **token** like `123456789:AAExxx...` — put it in `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456789:AAExxx...
   ```
4. **Send any message to your new bot** (e.g. "hi") — bots cannot message you
   first. This is required once.
5. Get your chat id:
   ```bash
   source .env
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates" \
     | python3 -c "import json,sys; [print(u['message']['chat']['id']) for u in json.load(sys.stdin).get('result',[]) if 'message' in u]"
   ```
6. Put it in `.env`:
   ```
   TELEGRAM_CHAT_ID=123456789
   ```

## 7. Run the app

```bash
pnpm dev
```

You should see, in order:

```
Job Hunter API listening on port 3000
scheduler started (intervalMinutes: 45)
telegram listener started (pollMs: 5000)
collection finished ... (source: irantalent / jobvision)
notifications sent ...
```

The first pipeline run starts **immediately** (not after 45 min). Keep the
terminal open; `Ctrl+C` stops everything cleanly.

> The app is a single process: API + scheduler + Telegram listener. To run it
> in production (background, auto-restart), see §16 (deployment).

## 8. Feed in your data

Two inputs make it YOUR job hunter:

### 8a. Your resume (PDF, DOCX, or TXT)

Put the file in the project root, then:

```bash
pnpm --filter @job-hunter/app ingest -- resume.pdf you@example.com
```

Output shows what was extracted (name, skills, titles, experience years,
locations). Re-running replaces your profile (single-profile MVP).

### 8b. Your search profile (what jobs you want)

```bash
pnpm --filter @job-hunter/app profile -- you@example.com "My Job Search" \
  --titles "Backend Developer,Node.js Developer,Software Engineer" \
  --required "Node.js" \
  --preferred "TypeScript,PostgreSQL,Docker" \
  --excluded "PHP,WordPress" \
  --locations "Remote,Tehran" \
  --types "full_time" \
  --min-score 60
```

What each flag means:

| Flag          | Meaning                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------- |
| `--titles`    | Job titles that count as relevant (English or Persian — "برنامه نویس بک اند" works too). |
| `--required`  | Keywords that must appear. Missing them lowers the score.                                |
| `--preferred` | Keywords that boost the score when present.                                              |
| `--excluded`  | **Hard filter** — any job mentioning these is rejected outright.                         |
| `--locations` | Hard filter: job must be in one of these (or Remote).                                    |
| `--types`     | Hard filter: employment types (full_time, part_time, ...).                               |
| `--min-score` | Only scores ≥ this get notified (0–100; 60 is a good start).                             |

Persian and English are interchangeable in all keyword fields — the matching
engine unifies them (e.g. "دورکاری" = "Remote", "برنامه نویس" = "Developer").

## 9. Verify everything works

```bash
# API is alive
curl -s http://localhost:3000/health
# → {"status":"ok", "features":{"telegram":true, ...}}

# Collection stats (jobs found/created per source, last run, health)
curl -s http://localhost:3000/ops/sources/health

# Jobs actually in the database
docker exec jobhunter-postgres psql -U jobhunter -d jobhunter \
  -c 'SELECT "sourceId", count(*) FROM "Job" GROUP BY 1;'
```

And your Telegram should receive messages for matches ≥ your `--min-score`,
each with the ⭐/❌ buttons. Press one — the buttons should change to a
confirmation chip within seconds.

## 10. Day-to-day usage

There is **nothing to do**. The app runs itself: every 45 minutes it collects
new jobs, matches, personalizes, and notifies. Your only job is pressing
⭐ Save / ❌ Not Relevant in Telegram — that feedback is what makes rankings
improve over time.

### Configure everything from Telegram (no terminal needed)

Send these commands to your bot in the chat:

| Command                                            | Effect                                     |
| -------------------------------------------------- | ------------------------------------------ |
| `/profile`                                         | Show your current search profile           |
| `/set titles Backend Developer,برنامه نویس بک اند` | Replace your target titles (Persian works) |
| `/set required Node.js,TypeScript`                 | Replace must-have keywords                 |
| `/set preferred PostgreSQL,Docker`                 | Replace booster keywords                   |
| `/set excluded PHP,WordPress`                      | Replace dealbreaker keywords (hard reject) |
| `/set locations Remote,Tehran`                     | Replace allowed locations (hard filter)    |
| `/set types full_time,contract`                    | Replace employment types (hard filter)     |
| `/set minscore 70`                                 | Set the notify threshold (0–100)           |
| `/clear excluded`                                  | Empty a field (see below)                  |
| `/pause` / `/resume`                               | Stop / restart notifications               |
| `/help`                                            | Command reference                          |

**Empty fields are neutral, not restrictive** — leaving something unset never
blocks a job:

| If empty...           | Behavior                                             |
| --------------------- | ---------------------------------------------------- |
| `excluded`            | no keyword is a dealbreaker                          |
| `locations`           | every location passes                                |
| `types`               | every employment type passes                         |
| `titles` / `required` | no score penalty (full credit)                       |
| `preferred`           | no boost possible (score comes from titles/required) |
| `minscore` (set to 0) | every passing job is notified (maximum volume)       |

So `/clear excluded` + `/clear locations` = "show me everything, judge by score only".

### Terminal commands (equivalent)

Tune things when needed:

```bash
# Change what you're looking for (re-run with new flags — same name updates it)
pnpm --filter @job-hunter/app profile -- you@example.com "My Job Search" --titles "..." ...

# Update your resume (after editing the file)
pnpm --filter @job-hunter/app ingest -- resume-v2.pdf you@example.com

# Run matching immediately without waiting for the next tick
pnpm --filter @job-hunter/app match -- you@example.com

# Send pending notifications right now
pnpm --filter @job-hunter/app notify
```

## 11. All CLI commands

| Command                                                           | What it does                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                                                        | Run API + scheduler + Telegram listener (foreground). |
| `pnpm build` / `pnpm start`                                       | Compiled production run.                              |
| `pnpm test`                                                       | Full test suite (needs TEST_DATABASE_URL — see §13).  |
| `pnpm lint` / `pnpm typecheck` / `pnpm format`                    | Code quality gates.                                   |
| `pnpm --filter @job-hunter/app ingest -- <file> <email>`          | Ingest a resume.                                      |
| `pnpm --filter @job-hunter/app profile -- <email> <name> [flags]` | Create/update your search profile.                    |
| `pnpm --filter @job-hunter/app match -- <email>`                  | Run matching + personalization now; prints top 10.    |
| `pnpm --filter @job-hunter/app notify`                            | Send pending matches to Telegram now.                 |

## 12. Viewing the database

**CLI** (quick):

```bash
docker exec -it jobhunter-postgres psql -U jobhunter -d jobhunter
```

```sql
\dt                                                   -- list tables
SELECT title, company, location, "salaryMin" FROM "Job" ORDER BY "postedAt" DESC NULLS LAST LIMIT 10;
SELECT score, status FROM "JobMatch" ORDER BY score DESC LIMIT 10;   -- match results
SELECT action, count(*) FROM "Feedback" GROUP BY 1;                  -- your button presses
SELECT "sourceId", status, found, created, duplicates, errors FROM "SourceRun" ORDER BY "startedAt" DESC LIMIT 10;
\q
```

**Visual (pgAdmin)**:

```bash
docker run -d --name jobhunter-pgadmin -p 5050:80 \
  -e PGADMIN_DEFAULT_EMAIL=admin@jobhunter.dev \
  -e PGADMIN_DEFAULT_PASSWORD=admin123 \
  -e PGADMIN_CONFIG_PROXY_X_FOR_COUNT=1 \
  -e PGADMIN_CONFIG_PROXY_X_PROTO_COUNT=1 \
  -e PGADMIN_CONFIG_PROXY_X_HOST_COUNT=1 \
  dpage/pgadmin4
```

Open http://localhost:5050, log in (`admin@jobhunter.dev` / `admin123`),
Add New Server → Connection: host `host.docker.internal` (or your host IP),
port 5432, user `jobhunter`, password `jobhunter`.

> Behind a codespace/HTTPS proxy, if pgAdmin shows a blank screen after login,
> also add `-e PGADMIN_CONFIG_ENHANCED_COOKIE_PROTECTION=False` and recreate.

## 13. Testing

Tests run against the **isolated** test database — never your real one:

```bash
TEST_DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter_test?schema=public" \
DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter_test?schema=public" \
  pnpm test
```

Expected: **24 files, 186 tests, all passing** (DB integration tests skip
automatically if `TEST_DATABASE_URL` is unset).

Coverage: unit (matching, terminology, resume, dedup, message formatting,
scheduler, AI parsing), fixture-based adapter tests (JobVision/IranTalent/
LinkedIn — no live sites are ever contacted), and DB integration (dedup,
pipelines, matching, notifications, personalization, end-to-end acceptance).

## 14. How the pipeline works

```
Resume (PDF/DOCX/TXT) ──▶ CandidateProfile (DB)         [ingest CLI, once]
SearchProfile (DB)     ──▶ titles/keywords/locations      [profile CLI, once]

            ┌──────────── every POLL_INTERVAL_MINUTES ────────────┐
            │ 1. COLLECT  JobVision API + IranTalent SSR pages     │
            │ 2. DEDUP    id → canonical URL → logical → hash     │
            │ 3. MATCH    hard filters → keyword/preference score  │
            │            (+ optional AI semantic score)           │
            │ 4. PERSONALIZE  your Save/Not-Relevant feedback      │
            │ 5. NOTIFY   Telegram (dedup: one message per job)   │
            └─────────────────────────────────────────────────────┘
                            ▼
        you press ⭐/❌  →  Feedback rows  →  better rankings next tick
```

Key behaviors:

- **Source isolation** — one site failing never blocks the other.
- **Crash safety** — restarts lose nothing; interrupted runs are detected and
  closed; notifications create a pending row _before_ sending.
- **No duplicate notifications** — one message per job ever.
- **AI optional** — without `OPENAI_API_KEY`, ranking is rule-based only.

## 15. Troubleshooting

| Symptom                                                     | Fix                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Can't reach database server at localhost:5432`             | `docker start jobhunter-postgres` (or `docker compose up -d postgres`).                                                                                                                              |
| `Invalid environment configuration: DATABASE_URL: Required` | `.env` missing/empty → redo §4.                                                                                                                                                                      |
| No Telegram messages                                        | (a) token/chat id wrong — §6; (b) you never messaged the bot first; (c) no matches ≥ min-score — run `match` CLI and check output; (d) `features.telegram` is `false` in `/health` → env not loaded. |
| Buttons don't respond / no chip                             | The app process is down (`pnpm dev` must be running); restart it.                                                                                                                                    |
| Port 3000 busy                                              | Set `PORT=3001` in `.env`.                                                                                                                                                                           |
| `pnpm test` fails with connection errors                    | Postgres was restarting — wait 10s and re-run; ensure `TEST_DATABASE_URL` points at `jobhunter_test`.                                                                                                |
| Old notifications re-appear                                 | They can't — per-job dedup is enforced by a DB constraint. Check `Notification` table.                                                                                                               |
| Prisma "migration failed" on new machine                    | Apply §5 step 1 again; migrations are idempotent.                                                                                                                                                    |

## 16. Deployment (production)

Two ways to run this beyond dev mode:

### A. Compiled build (pm2 / systemd / any process manager)

```bash
pnpm build                                   # compiles packages/app → dist/
DATABASE_URL="...your production postgres..." \
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
  pnpm --filter @job-hunter/app start        # = node dist/main.js
```

With pm2: `pm2 start packages/app/dist/main.js --name job-hunter` (env vars
from `ecosystem.config.js` or a loaded `.env` — `dotenv` reads the repo-root
`.env` at startup). `SIGINT/SIGTERM` are handled: scheduler stops, listener
stops, Prisma disconnects cleanly.

### B. Docker Compose (app + postgres)

```bash
# set real values in .env first (the compose file reads them)
docker compose up -d --build
```

This starts `postgres` (with a persistent volume) and the `app` container,
applies nothing automatically — run migrations once after first start:

```bash
docker compose exec app pnpm exec prisma migrate deploy
# or from the host:
DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter?schema=public" \
  pnpm --filter @job-hunter/app exec prisma migrate deploy
```

Health checks: `curl http://<host>:3000/health` and `/ops/sources/health`.

### Production checklist

- [ ] `NODE_ENV=production` in `.env` (structured JSON logs, no pretty printing)
- [ ] Real Postgres URL with a non-default password (`POSTGRES_PASSWORD`)
- [ ] `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` set
- [ ] Migrations applied (`prisma migrate deploy` — never `db push` in prod)
- [ ] Optional: `OPENAI_API_KEY` for semantic ranking
- [ ] Restart policy: compose has it; pm2/systemd provide it natively
- [ ] Logs: pino writes JSON to stdout — pipe to your log stack

---

**Project docs:** [ARCHITECTURE.md](ARCHITECTURE.md) (design detail) ·
[PROJECT_STATUS.md](PROJECT_STATUS.md) (milestones) ·
[docs/sources/](docs/sources/) (per-source investigation notes)
