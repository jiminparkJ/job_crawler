# LinkedIn — Permitted Integration (M7)

**Status: IMPLEMENTED (optional ingestion)** — `packages/app/src/sources/linkedin/linkedinSource.ts`

## Approach (per PROMPT §5)

LinkedIn is integrated exclusively through its **native Job Alerts email flow**:

```
LinkedIn Job Alerts (user opts in on linkedin.com)
        ↓
User's email inbox
        ↓
Job Hunter ingests the alert emails (transport-agnostic loader)
        ↓
Extract job URLs + ids (extractJobLinks)
        ↓
Normalize from alert subject (title/company)
        ↓
Matching pipeline → Telegram (link goes straight to LinkedIn)
```

No LinkedIn scraping, no login automation, no CAPTCHA/anti-bot handling, no
browser extension. The user configures job alerts on LinkedIn themselves;
Job Hunter only reads the emails the user receives.

## Transport-agnostic email loading

`LinkedInAlertSource` takes an injected `loadEmails()` provider. Deployment
options (user-configurable):

1. **IMAP poller** (recommended for production): connect with app-specific
   credentials to the user's mailbox, filter by sender, pass `{from, subject,
body, receivedAt}` objects to the source. Not auto-configured — requires
   the user's mailbox credentials (a genuine user-input blocker to stop for).
2. **Exported mailbox file**: an .mbox/.eml drop directory parsed offline.
3. **Manual forwarding**: user forwards alerts to an ingested address.

The system remains fully functional with LinkedIn disabled
(`LINKEDIN_ENABLED=false`, the default): collection, matching, and Telegram
all run from JobVision + IranTalent.

## Fields extracted

- Job id + canonical URL from `linkedin.com/jobs/view/{id}` links
  (tracking params stripped; localized domains normalized to www).
- Title + company from alert subject (`Title at Company` pattern).
- `receivedAt` → postedAt approximation.

Deliberately NOT extracted: job descriptions from LinkedIn pages (that would
require automated access to LinkedIn itself). Matching runs on the alert
subject; the Telegram notification links directly to LinkedIn.

## Failure modes

- Non-LinkedIn or non-alert emails → ignored (sender + subject heuristics).
- Emails with no job links → zero listings (not an error).
- Duplicate links within/between emails → deduplicated by job id; the DB
  `(sourceId, externalId)` unique constraint is the final guard.

## Tests

`packages/app/test/linkedin.test.ts` — 13 tests: sender/subject recognition,
link extraction (canonical ids, localized domains, dedup), ingestion,
subject normalization, adapter search/fetch over injected emails.
