# IranTalent (irantalent.com) — Source Investigation (M3)

Investigated: 2026-09-02. **Status: ADAPTER IMPLEMENTED & TESTED** — `packages/app/src/sources/irantalent/irantalentSource.ts`

## Implementation summary

- `IranTalentSource`: search/searchRows (SSR HTML pages, brace-matched embedded-JSON extraction), fetchJob (known row direct / search fallback), normalize (anonymous employers, Rial salaries, work_type/employment mapping, HTML stripping).
- `runIranTalentCollection` in `packages/app/src/pipeline/collection.ts`; source-isolation test proves JobVision failure never blocks IranTalent.
- Tests: `packages/app/test/irantalent.test.ts` (22 unit tests) + pipeline DB tests (7).
- Fixtures: `packages/app/test/fixtures/irantalent/{list,detail-182473}.json` (real SSR payloads, captured 2026-09-02).

## Discovery method

1. `https://www.irantalent.com/en/jobs` is an Angular SPA **with server-side rendering**; every search listing page embeds the full result JSON in the HTML (`serverSideSearchResult` key) plus an `ng-state` TransferState script.
2. The backing API `https://api.irantalent.com/api/v1/employer/position/search-by-slug?page=N` returns **404 `{"message":"Not found"}`** for direct requests even with browser-like headers (Accept/Origin/Referer/X-Requested-With). The API appears restricted to server-side calls. We therefore read the **SSR HTML pages** — the site's own intended public interface (PROMPT §4: "Structured page data" level, no bypass of any access control; no CAPTCHA/anti-bot encountered).
3. Pagination: `?page=N` (30/page, `last_page` embedded). Category filters work as URL slugs: `/en/jobs/it-software-web-development-filter-jobs`, `/en/jobs/jobs-in-tehran`, `/en/jobs/jobs-for-experienced-professional`, etc. A free-text `?search=` param is **ignored** by the SSR page (no filtering effect) — keyword filtering must happen client-side in the adapter (our matcher already handles that).

## Job listing fields (from embedded `serverSideSearchResult.data[]`)

```json
{
  "id": 182480,
  "title": "Trading Manager", "title_farsi": "مدیر بازرگانی",
  "slug": "trading-manager",                    // URL: /job/{slug}/{id} (Persian UI)
  "salary_from": 1000000000, "salary_to": null, // RIALS (1e9 IRR = 100M Tomans? No: 1000000000 IRR = 100 Million Tomans)
  "is_show_salary": true,
  "work_type": "on_site" | "hybrid" | "remote",
  "employment_type": { "id": 186, "title": "Full Time", "slug": "Full-Time-employment-type" },
  "location": { "id": 216, "title": "Tehran", "title_farsi": "تهران", "parent": {"id": 2, "title": "Iran"} },
  "location_text": "Tehran", "location_text_farsi": "تهران",
  "job_category": [ { "id": 238, "title": "Purchasing & Procurement", "slug": "..." } ],
  "seniority": [ { "id": 272, "title": "Junior Professional", "slug": "junior-professional" } ],
  "role_description": "<p>...HTML...</p>",       // full description available in LIST rows (no detail request needed for basic collection)
  "role_description_farsi": "...",
  "employer": { "id": 1861, "name": "...", "name_farsi": "...", "slug": "...", "industry_id": "249" },
  "is_anonymous": true, "anonymous_data": { "name_en": "...", ... }, // used when employer is hidden
  "created_at": "2026-09-02",                    // date only
  "lived_at": "2026-09-02 15:10:35",             // datetime (no TZ — site local, treat as UTC approx)
  "expired_at": null, "status": {"id": 169, "title": "Live"},
  "reference_code": "P0182-480"
}
```

Notes:

- **Salary is in Rials** (`salary_from: 450000000` = 45M Tomans). Convert: `toman = rial / 10`. Store as `salaryCurrency: 'IRR'` with raw values; the matcher's salary floor uses one unit consistently.
- List rows already contain `role_description` (full HTML) — detail fetch is **optional**; use it only to enrich (`requirements_description`, `minimum_experience`, `keyword_*` fields, `study_fields`).
- `seniority` is an array (usually 1 entry).
- `is_anonymous` + `anonymous_data.name_en` provide the display name when the employer is hidden.

## Job detail (optional enrichment)

URL: `https://www.irantalent.com/job/{slug}/{id}` (Persian UI, no `/en/` prefix; the English variant `/en/job/...` also resolves but we link the Persian default) — SSR HTML embeds full position payload in `<script id="ng-state">` (Angular TransferState, keyed object; find the object containing `role_description` + `id`).

Extra fields beyond list rows: `requirements_description(_farsi)`, `minimum_experience`, `minimum_experience_to_reject`, `keyword_current_job_title`, `keyword_product_tools_skills`, `study_fields`, `minimum_english_fluency_level_id`, `salary_rate_sign`, `approved_at`, `expires_at`, `view_count`.

## Authentication requirements

None for public listings/detail pages. No CAPTCHA, no login wall, no rate-limiting encountered at polite request rates. The direct JSON API is blocked (404) — we do not attempt to bypass; we use the SSR pages.

## Known failure modes

- 404 for expired/deleted jobs (SSR still renders shell HTML — check for `serverSideSearchResult` presence and `title`).
- Anonymous employers (`is_anonymous`) — use `anonymous_data.name_en`/`name_fa`.
- `salary_from/to` null or `is_show_salary: false`.
- `lived_at` has no timezone — parse as UTC (minor drift acceptable for dedup ordering).
- Embedded JSON is inside HTML — must brace-match extract, not regex-parse; malformed HTML → skip page.
- `role_description` is HTML → strip (reuse JobVision's `stripHtml`).
- Page count can shrink between requests (jobs expiring) — always stop on empty page.

## Collection strategy

1. Enumerate configured category slugs (default: `it-software-web-development-filter-jobs`) × pages 1..last_page.
2. Parse embedded `serverSideSearchResult` from each page (brace-matched JSON extraction).
3. Normalize list rows directly (description from `role_description`); optionally fetch detail pages for enrichment (off by default to be polite).
4. Location/keyword filtering happens in the matcher (API's own free-text search is unreliable).

## Responsible adapter

`packages/app/src/sources/irantalent/irantalentSource.ts` (`IranTalentSource`), fixtures `packages/app/test/fixtures/irantalent/{list,detail-182473}.json`, tests `packages/app/test/irantalent.test.ts`.
