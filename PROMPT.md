# JOB HUNTER — AUTONOMOUS DEVELOPMENT INSTRUCTIONS

You are the lead engineer and autonomous coding agent responsible for building the **Job Hunter** project described in this repository.

Your job is to take the project from its current state to a working production-ready MVP by executing the development milestones **sequentially and autonomously**.

Do not wait for the user between normal milestones.

---

# 1. AUTONOMOUS EXECUTION MODE

Work through the milestones in order:

```text
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9
```

For every milestone:

1. Inspect the current repository state.
2. Read relevant existing code and documentation.
3. Determine what has already been implemented.
4. Identify the remaining work for the milestone.
5. Create a short implementation plan.
6. Implement the milestone.
7. Run formatting.
8. Run linting.
9. Run type checking.
10. Run unit tests.
11. Run integration tests when applicable.
12. Fix all discovered problems.
13. Update documentation.
14. Update the project progress tracker.
15. Create/update tests for the implemented functionality.
16. Verify that previous milestones still work.
17. Commit the work logically if git is available.
18. Immediately continue to the next milestone.

Do NOT stop simply because a milestone has been completed.

Continue automatically until:

- all milestones are completed, OR
- a genuine blocker requires user input.

---

# 2. WHEN YOU ARE ALLOWED TO STOP

Stop and ask the user only when continuing would require information that cannot reasonably be determined from the repository, documentation, environment, or safe investigation.

Examples of legitimate blockers:

- required credential/API key that only the user can provide
- Telegram bot token
- unavailable external service
- a website requires a user account/session that cannot be configured automatically
- conflicting requirements
- destructive action requiring confirmation
- legal/authorization uncertainty that cannot be resolved
- missing resume when resume processing is required

Do NOT stop for:

- ordinary implementation decisions
- choosing between reasonable libraries
- naming files
- naming functions
- choosing database indexes
- choosing normal architectural patterns
- minor UI decisions
- writing tests
- refactoring
- fixing errors
- improving documentation

Make reasonable engineering decisions yourself.

---

# 3. NEVER FAKE COMPLETION

A milestone is NOT complete merely because code was written.

Before marking a milestone complete, verify it.

For example:

```text
❌ "Implemented JobVision adapter."

is insufficient.

Instead:

✓ Adapter implemented
✓ Fixture created
✓ Parser tested
✓ Normalization tested
✓ Database persistence tested
✓ Duplicate handling tested
✓ Integration test passed
✓ Error handling tested
✓ Documentation updated
```

Never claim a feature works when it has not been tested.

Never invent API endpoints, website behavior, credentials, test results, or external data.

---

# 4. EXTERNAL WEBSITE INVESTIGATION

For JobVision and IranTalent, investigate their CURRENT implementation before writing the collector.

Do not assume that an API exists.

Use this priority:

```text
Official documented API
        ↓
Official/public endpoint
        ↓
Structured page data
        ↓
Normal HTTP requests
        ↓
Browser rendering
```

Use browser automation only when necessary.

Respect the website's access controls and terms.

Do not implement:

- CAPTCHA bypass
- anti-bot bypass
- stealth/fingerprint evasion
- rate-limit bypass
- authentication bypass
- access-control bypass

If the site's current architecture prevents reliable permitted automated collection, document the limitation and implement the best legitimate alternative.

---

# 5. LINKEDIN

Treat LinkedIn separately.

Do NOT implement unauthorized automated scraping of LinkedIn.

Do NOT create:

- LinkedIn scraper
- stealth Playwright scraper
- CAPTCHA bypass
- anti-bot evasion
- automated LinkedIn login
- browser extension designed to circumvent LinkedIn restrictions

Prefer:

```text
LinkedIn native Job Alerts
        ↓
Email / permitted notification mechanism
        ↓
Job Hunter
        ↓
Extract job information / URL
        ↓
Normalize
        ↓
Match
        ↓
Telegram
```

If an official LinkedIn API legitimately available for this use case provides the required functionality, it may be evaluated.

Otherwise implement LinkedIn as an independent integration point that does not block the rest of the system.

---

# 6. ENGINEERING PRINCIPLES

Follow these principles throughout the project:

### Separation of concerns

Source adapters must only deal with source-specific discovery/parsing.

Matching must not know how jobs were fetched.

Telegram must not know how jobs were discovered.

Database code must not contain business logic.

AI providers must be replaceable.

### Reliability

The worker must be:

- restart-safe
- idempotent
- failure-tolerant

One broken source must not stop other sources.

### Configuration

Do not hardcode:

- search keywords
- score thresholds
- Telegram credentials
- AI credentials
- polling intervals
- source configuration

unless they are genuine application defaults.

### Security

Never commit secrets.

Never expose secrets in logs.

Validate external data.

---

# 7. TECHNOLOGY

Preferred stack:

```text
TypeScript
Node.js
pnpm
Fastify
PostgreSQL
Prisma
Vitest
ESLint
Prettier
Docker
Telegram Bot API
```

Use Playwright only where necessary.

Use an AI-provider abstraction.

Avoid unnecessary infrastructure.

Do not introduce Redis, Kafka, RabbitMQ, Kubernetes, vector databases, or microservices unless a real requirement emerges.

---

# 8. PROJECT MILESTONES

Execute these sequentially.

---

## M0 — FOUNDATION

Implement:

- repository structure
- pnpm workspace
- TypeScript
- Fastify
- PostgreSQL
- Prisma
- Docker
- environment configuration
- ESLint
- Prettier
- Vitest
- structured logging
- health endpoint

Create:

```text
.env.example
README.md
PROJECT_STATUS.md
```

Validate everything.

Then automatically continue to M1.

---

## M1 — RESUME / CANDIDATE PROFILE

Implement:

```text
Resume
 ↓
Text extraction
 ↓
Candidate profile
 ↓
Database
```

Support:

- PDF
- DOCX
- TXT

Extract:

- skills
- experience
- job titles
- seniority
- education
- languages
- industries
- locations
- other relevant professional information

Do not invent resume information.

Create a structured `CandidateProfile`.

Allow inferred information to be distinguished from explicitly extracted information.

Validate the implementation with fixtures/tests.

Then automatically continue to M2.

---

## M2 — JOBVISION

Investigate the current JobVision website first.

Determine:

- search mechanism
- filters
- pagination
- listing structure
- job URLs
- job IDs
- detail-page structure
- structured data
- network requests
- authentication requirements

Choose the best legitimate technical approach.

Implement:

```text
JobVisionSource
    ↓
search()
    ↓
fetchJob()
    ↓
normalize()
```

Create realistic fixtures.

Test:

- parsing
- normalization
- malformed data
- duplicate jobs
- network failure
- missing fields

Then automatically continue to M3.

---

## M3 — IRANTALENT

Repeat the same process for IranTalent.

Investigate the CURRENT website before implementation.

Implement:

```text
IranTalentSource
    ↓
search()
    ↓
fetchJob()
    ↓
normalize()
```

Keep all IranTalent-specific logic isolated.

Test thoroughly.

Then automatically continue to M4.

---

## M4 — UNIFIED JOB PIPELINE

Implement:

```text
JobVision ──┐
            ├── NormalizedJob
IranTalent ─┘
                  ↓
             Deduplication
                  ↓
               Database
```

Implement:

- source-independent job model
- source listings
- canonical URLs
- external IDs
- content hashes
- duplicate detection
- logical-job deduplication

The same job appearing on multiple websites should not generate duplicate notifications.

However, retain every original source listing and URL.

Then automatically continue to M5.

---

## M5 — RULE-BASED MATCHING

Implement:

```text
Job
 ↓
Hard filters
 ↓
Keyword matching
 ↓
Preference matching
 ↓
Score
```

Support:

- title matching
- skill matching
- experience
- seniority
- location
- remote
- employment type
- salary where available
- excluded keywords

Implement Persian/English normalization.

For example:

```text
برنامه نویس بک اند
Backend Developer
Backend Engineer
Back-end Developer
```

should be recognized as related.

Create a configurable terminology dictionary.

Do not hardcode terminology throughout the source code.

Then automatically continue to M6.

---

## M6 — TELEGRAM

Implement Telegram notifications.

Example:

```text
🚀 91% MATCH

Backend Engineer

🏢 Example Company
📍 Remote
💼 Full-time

━━━━━━━━━━━━━━━━

MATCHED
✓ Node.js
✓ TypeScript
✓ PostgreSQL

POTENTIAL GAPS
⚠ Kubernetes

WHY
Strong overlap with your experience.

━━━━━━━━━━━━━━━━

[ 🔗 View Job ]

[ ⭐ Save ] [ ❌ Not Relevant ]
```

Implement:

- job URL
- match score
- matched skills
- missing skills
- explanation
- Save
- Not Relevant

Persist all Telegram interactions.

Prevent duplicate notifications.

If Telegram fails, keep the job/match persisted and retry later.

Then automatically continue to M7.

---

## M7 — LINKEDIN

Implement a permitted LinkedIn integration.

Preferred:

```text
LinkedIn Job Alerts
        ↓
Email/notification ingestion
        ↓
Extract job URL
        ↓
Analyze job
        ↓
Match
        ↓
Telegram
```

Do not scrape LinkedIn without authorization.

LinkedIn integration must be optional.

The system must remain fully functional if LinkedIn is disabled.

Then automatically continue to M8.

---

## M8 — AI MATCHING

Add optional semantic matching.

Architecture:

```text
Rule score
    ↓
Promising candidates
    ↓
AI analysis
    ↓
Semantic score
    ↓
Final score
```

Do NOT send every job to the AI.

Create:

```typescript
interface AIProvider {
  analyzeJobMatch(candidate: CandidateProfile, job: NormalizedJob): Promise<JobMatchAnalysis>;
}
```

Use structured, schema-validated AI output.

Example:

```json
{
  "score": 87,
  "recommendation": "strong_match",
  "matchedSkills": ["Node.js", "TypeScript"],
  "missingSkills": ["Kubernetes"],
  "reasons": ["Strong backend experience overlap"],
  "concerns": ["Kubernetes is preferred"]
}
```

Handle:

- provider errors
- timeouts
- malformed responses
- invalid JSON
- rate limits
- unavailable provider

AI failure must never destroy the job pipeline.

Then automatically continue to M9.

---

## M9 — PERSONALIZATION + HARDENING

Implement:

- feedback tracking
- saved jobs
- ignored jobs
- interested jobs
- applied status
- personalized ranking
- source health
- retry behavior
- improved logging
- monitoring
- documentation
- production hardening

Do not introduce machine learning unnecessarily.

Start with explainable preference adjustments.

---

# 9. DATABASE

Use PostgreSQL + Prisma.

Core models:

```text
User
CandidateProfile
SearchProfile
JobSource
Job
JobSourceListing
JobMatch
Notification
Feedback
SourceRun
```

Ensure proper:

- indexes
- unique constraints
- foreign keys
- cascading behavior
- timestamps
- migrations

Design for future multi-user support even if the first deployment has one user.

---

# 10. SEARCH PROFILES

Search criteria must be configurable.

Example:

```json
{
  "name": "Backend Jobs",
  "targetTitles": ["Backend Developer", "Backend Engineer", "Node.js Developer"],
  "requiredKeywords": ["Node.js", "TypeScript"],
  "preferredKeywords": ["PostgreSQL", "Docker"],
  "excludedKeywords": ["PHP", "WordPress"],
  "locations": ["Remote", "Tehran"],
  "minimumMatchScore": 75
}
```

Do not hardcode these values as permanent application logic.

---

# 11. MATCH SCORE

Initial default weighting:

```text
Keyword score       35%
Semantic score      45%
Preference score    20%
```

Before AI is enabled, gracefully handle the absence of semantic scoring.

Minimum default notification score:

```text
75
```

Make all values configurable.

---

# 12. DEDUPLICATION

Use multiple levels:

```text
source + external ID
        ↓
canonical URL
        ↓
title + company + location
        ↓
content similarity if necessary
```

Never send the same logical job repeatedly.

---

# 13. SCHEDULER

Run the job discovery process periodically.

Default:

```text
30–60 minutes
```

Make configurable.

The scheduler must survive process restarts.

Avoid unnecessary queue infrastructure.

---

# 14. SOURCE FAILURE ISOLATION

Example:

```text
JobVision   ✓
IranTalent  ✗
LinkedIn    —
```

The overall worker must still succeed.

Record:

- start
- completion
- duration
- jobs found
- new jobs
- duplicates
- errors

using `SourceRun`.

---

# 15. TEST STRATEGY

Every milestone must add appropriate tests.

Required categories:

```text
Unit
Integration
Parser fixtures
Database
Matching
Deduplication
Notifications
Error handling
```

Do not make normal tests depend on live websites.

Use recorded fixtures/mocks for source tests.

Create separate optional live/integration checks when useful.

---

# 16. DOCUMENTATION

Maintain:

```text
README.md
PROJECT_STATUS.md
ARCHITECTURE.md
```

`PROJECT_STATUS.md` must always show:

```text
M0 Foundation              COMPLETE
M1 Resume                  COMPLETE
M2 JobVision               IN PROGRESS
M3 IranTalent              PENDING
...
```

Update it after every milestone.

For every source document:

- discovery method
- limitations
- fields extracted
- authentication requirements
- known failure modes
- responsible adapter

---

# 17. GIT

If the repository is a git repository:

Use logical commits.

Prefer:

```text
feat: implement project foundation
feat: add candidate profile
feat: add JobVision source
feat: add IranTalent source
feat: add job normalization
feat: add matching engine
feat: add Telegram notifications
feat: add LinkedIn alert integration
feat: add AI matching
feat: add personalization
```

Do not create meaningless commits.

Never commit secrets.

---

# 18. FINAL ACCEPTANCE TEST

Before declaring the project complete, perform an end-to-end test:

```text
Resume
  ↓
Candidate Profile
  ↓
Search Profile
  ↓
JobVision / IranTalent
  ↓
Job discovery
  ↓
Normalization
  ↓
Deduplication
  ↓
Hard filtering
  ↓
Rule matching
  ↓
AI matching where enabled
  ↓
Final score
  ↓
Telegram
  ↓
User feedback
  ↓
Database
```

Verify that a real or realistic test job can travel through the entire pipeline.

---

# 19. FINAL BEHAVIOR

You are an autonomous implementation agent.

Do not repeatedly ask:

> "Should I continue?"

Continue automatically.

Do not stop after merely generating a plan.

Actually implement the project.

Do not skip validation.

Do not claim success without evidence.

When blocked by a genuine external dependency, stop and clearly report:

```text
BLOCKED

Reason:
What is needed:
Why it cannot be resolved automatically:
What has already been completed:
```

Otherwise keep moving.

---

# START NOW

First inspect the repository.

Determine its current state.

Then begin **M0 — Foundation**.

After M0 passes validation, automatically continue through the remaining milestones sequentially.

Do not wait for user approval between milestones.
