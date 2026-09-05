# JobVision (jobvision.ir) — Source Investigation (M2)

Investigated: 2026-09-02, from the live site's own Angular SPA code (no auth, no browser automation).
**Status: ADAPTER IMPLEMENTED & TESTED** — `packages/app/src/sources/jobvision/jobvisionSource.ts`

## Implementation summary

- `JobVisionSource` implements search (via `searchRows` returning raw posts), `fetchJob` (detail), `normalize`, `normalizeWithDetail` (list+detail merge), `stripHtml` (description HTML→text).
- HTTP goes through `UndiciHttpClient` (`packages/app/src/sources/http.ts`): timeout, single retry on transient errors, no 4xx retry.
- Collection pipeline (`packages/app/src/pipeline/collection.ts`) records SourceRun stats, tolerates per-job failures, never lets one source break the run.
- Tests: `packages/app/test/jobvision.test.ts` (19 unit/fixture tests), `collectionPipeline.integration.test.ts` (4 DB tests) + `jobRepository.integration.test.ts` (8 dedup tests).
- Fixtures: `packages/app/test/fixtures/jobvision/{list,detail-1455488}.json` (real API payloads, captured 2026-09-02).

## Discovery method

1. `https://jobvision.ir` is an Angular SPA (`main.<hash>.js` bundle, lazy chunks).
2. Bundle analysis revealed the app's own REST backend base: `https://candidateapi.jobvision.ir` (plus `basedataapi.jobvision.ir`).
3. All endpoints below were verified with plain `curl` — public, no authentication, no CAPTCHA, normal HTTP. This satisfies the PROMPT §4 priority: "Official/public endpoint" over browser rendering. Playwright is NOT needed.

## Endpoints (all under `https://candidateapi.jobvision.ir/api/v1`)

### 1. Job search — `POST /JobPost/List`

**IMPORTANT: body keys are camelCase** (`keyword`, `requestedPage`, `pageSize`, `sortBy`, `isRemote`, ...).
A PascalCase body (`Query`/`PageNumber`/`PageSize`) is _accepted_ but ignores the filters and returns the unfiltered firehose (51k+ jobs) — a trap discovered during investigation. The camelCase shape is what the site's SPA actually sends (found via `convertJobPostBodyToQueryParam` in the bundle).

Request body (all keys optional):

```json
{
  "keyword": "node.js",
  "requestedPage": 1,
  "pageSize": 20,
  "sortBy": 0,
  "isRemote": true,
  "isInternship": false,
  "workTypes": [120],
  "seniorityLevels": [97, 172],
  "workExperiences": [2, 3],
  "salaryRanges": [5],
  "searchTimeRange": 1,
  "locationWrapper": "…see note…",
  "jobCategoryUrlTitle": "…",
  "industries": [64],
  "jobBenefits": [115]
}
```

- `sortBy`: **0 = newest (جدیدترین), 1 = most relevant (مرتبط‌ترین), 2 = highest salary (بیشترین حقوق)** — numeric enum; string values are rejected with 400. Verified against the server-rendered `<option>` labels on `/jobs/keyword/nodejs`.
- `pageSize` honored (verified 5/10/…); pagination via `requestedPage`, response echoes `currentPage`/`pageSize`/`jobPostCount`.
- `isRemote: true` verified to filter correctly (21 remote node.js hits).
- **`locationWrapper` accepts strings like `"in-all-cities-of-tehran"` but does NOT actually filter** (server returned all 51k for Tehran-only). Location filtering via API body is therefore unreliable — apply location filtering client-side in the adapter, or use the province of each job post (available in the response rows).

Response envelope: `{ isSuccess, message, data: { jobPosts: [...], currentPage, pageSize, jobPostCount, filters, searchId } }`.

Each job post row (List):

```json
{
  "id": 1455488,
  "title": "Node.js developer",
  "isPersian": true,
  "properties": {
    "isInternship": false,
    "isRemote": false,
    "isUrgent": true,
    "requiredRelatedExperienceYears": 2,
    "typeId": 1,
    "salaryCanBeShown": true
  },
  "company": { "id": 17380, "nameFa": "…", "nameEn": "…", "pageUrl": "/companies/17380/…" },
  "location": {
    "country": { "titleFa": "ایران", "titleEn": "Iran" },
    "province": { "id": 17, "titleFa": "تهران", "titleEn": "Tehran" },
    "city": { "id": 320, "titleFa": "تهران", "titleEn": "Tehran" }
  },
  "jobCategories": [
    { "id": 30, "titleFa": "توسعه نرم افزار…", "titleEn": "IT - Software Development…" }
  ],
  "benefits": [{ "id": 116, "titleEn": "Loan" }],
  "workType": { "id": 120, "titleFa": "تمام وقت", "titleEn": "Full Time" },
  "seniorityLevel": { "id": 97, "titleFa": "کارشناس", "titleEn": "Specialist" },
  "salary": {
    "min": 45,
    "max": 60,
    "titleFa": "45 - 60 میلیون تومان",
    "titleEn": "45 - 60 Million Tomans"
  },
  "industry": { "id": 64, "titleEn": "Trading / International Affairs" },
  "activationTime": { "date": "2026-09-01T15:46:27Z", "beautifyEn": "…" },
  "expireTime": { "date": "…", "daysLeftUntil": 60 }
}
```

- **Salary units are million Tomans/month** (`min`/`max` numeric; `titleEn` human label). `salary: null` when hidden.
- `activationTime.date` → postedAt.

### 2. Job detail — `GET /JobPost/Detail?jobPostId={id}`

200 with `{ data: { … } }` for valid ids, 404 ProblemDetails for unknown.
Detail fields (superset in some areas, missing `workType`):

- `description` — **HTML string** (RTL `<div dir="rtl">…`), needs tag-stripping for matching.
- `softwareRequirements: [ { "software": { "titleFa": "Node.js", "titleEn": "Node.js" }, "skill": { "titleFa": "متوسط", "titleEn": "Intermediate" } } ]` → skills list + proficiency.
- `skills: []` (empty in observed sample; softwareRequirements is the real skills carrier).
- `typeId` (int), `isRemote`, `isInternship`, `requiredRelatedExperienceYears`, `salary`, `seniorityLevel`, `location`, `jobCategories`, `benefits`, `languageRequirements` (null in sample), `requiredKnowledge` (null), `academicRequirements`, `company: { name: { titleFa, titleEn }, size, website, … }`.
- **`workType` is NOT in Detail** — carry it from the List row or map from `typeId`/categories.
- `expireTime`, `firstActivationTime`, `activationTime` present.

### 3. Filters reference — `GET /JobPost/GetAllSearchFilters`

Static enums (id → label):

- `workTypes`: 120 Full Time / 121 Part Time / 122 Project-Based (urlParameters `full-time`/`part-time`/`project-based`)
- `seniorityLevels`: 246 Worker / 96 Employee / 97 Specialist / 172 Senior Specialist / 98 Manager / 99 Deputy–Senior Manager / 100 CEO
- `workExperienceRequirements`: -1 Without experience / 1 Under 2y / 2 2–5y / 3 5–8y / 4 8–12y / 5 12y+
- `salaryRanges`, `timeRanges` (1 last 3 days, 2 last week, 3 last 15 days, 4 last month…), `industries`, `jobBenefits`, `jobCategories`.

### 4. Public job URL (for notifications)

`https://jobvision.ir/jobs/{id}` — 301→200 (redirect then render), title tag: `استخدام {title} در {company}`.
Company page URL: `https://jobvision.ir{company.pageUrl}`.

## Normalization mapping (planned for adapter)

| JobVision field                                               | NormalizedJob field                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`                                                          | `externalId` (string)                                                                    |
| `/jobs/{id}`                                                  | `url` / canonicalUrl                                                                     |
| `title`                                                       | `title`                                                                                  |
| `company.nameFa`/`nameEn` (Detail: `company.name.titleFa/En`) | `company` (prefer Fa; keep En in raw)                                                    |
| `description` (HTML → strip tags)                             | `description`                                                                            |
| `location.province.titleEn` + `city.titleEn`                  | `location` (`"Tehran, Tehran"` style or city only)                                       |
| `properties.isRemote`/`isRemote`                              | `remote: 'remote' \| null` (hybrid/onsite not modeled by JobVision)                      |
| `workType.titleEn` (List) or typeId map                       | `employmentType`: Full Time→`full_time`, Part Time→`part_time`, Project-Based→`contract` |
| `isInternship`                                                | override `employmentType = 'internship'` when true                                       |
| `salary.min/max`                                              | `salaryMin/salaryMax` (converted to Rials: ×10,000,000; `salaryCurrency: 'IRR'`)         |
| `activationTime.date`                                         | `postedAt`                                                                               |
| `softwareRequirements[].software.titleEn`                     | `skills`                                                                                 |

## Authentication requirements

None for search/detail. Rate limits unknown — be polite (single-digit QPS, backoff on 429/5xx). No CAPTCHA/anti-bot encountered with plain requests and a normal User-Agent.

## Known failure modes (all covered by tests)

- Envelope `isSuccess: false` with 200 (business error) — must check, not just HTTP code.
- 404 ProblemDetails JSON for deleted/expired jobs (`expireTime.daysLeftUntil`).
- `salary: null`, `workType` occasionally absent, missing city/province, empty `softwareRequirements`.
- PascalCase body silently ignoring filters (use camelCase!).
- String `sortBy` values → HTTP 400.
- Rows with missing `id` are skipped; missing titles fall back; invalid dates → null.

## Responsible adapter

`packages/app/src/sources/jobvision/jobvisionSource.ts` (`JobVisionSource`), HTTP via `packages/app/src/sources/http.ts`, pipeline wiring in `packages/app/src/pipeline/collection.ts`.
