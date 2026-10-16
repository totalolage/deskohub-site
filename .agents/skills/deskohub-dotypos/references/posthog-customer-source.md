# PostHog customer source

PostHog's Custom REST data-warehouse source pulls Dotypos customers from the
Workspace app so analysts can join them to persons on `dotypos_customer_id`.
Customer data passes through request memory only. Never write it to Neon, a
bucket, a cache, or logs. PostHog owns the schedule and the stored copy.

## Code

Paths are relative to `apps/deskohub-workspace` unless they start with
`packages/`.

- Route: `app/api/analytics-warehouse/dotypos-customers/route.ts`.
- Workflow, field allowlist, cursor, and status mapping:
  `features/analytics-warehouse/backend/dotypos-customer-source.ts`.
- Access gate: `features/analytics-warehouse/backend/dotypos-customer-source-access.service.ts`.
- Dotypos read: `DotyposService.listCustomerChanges` in
  `packages/dotypos/src/backend/service.ts`.
- Export budget: `dotyposCustomerExportBudget` in the workflow file, spent
  through `RequestBudget` (`shared/backend/request-budget/`, table
  `request_budget_spends`).

## Access

- `ANALYTICS_WAREHOUSE_SOURCE_TOKEN` (at least 32 characters) enables the
  source. Set it only in the Production Vercel environment.
- The source answers 404 without calling Dotypos unless `VERCEL_ENV` is
  `production` and the token is set. Previews and development run unreviewed
  branches against real Dotypos data, so a token that reaches them by mistake
  must not open the source.
- PostHog sends `Authorization: Bearer <token>`. The route compares digests in
  constant time and answers 401 with `WWW-Authenticate: Bearer` otherwise.
- To rotate the token, set the new value in Vercel Production, redeploy, then
  update the PostHog source.

## Contract

`GET https://workspace.deskohub.cz/api/analytics-warehouse/dotypos-customers`

| Query | Meaning |
| --- | --- |
| `since` | ISO 8601 instant. Returns customers whose `versionDate` is at or after it. PostHog sends its stored maximum `versionDate` here; it omits the parameter on the first sync. |
| `cursor` | Opaque position from the previous page's `next_cursor`. Takes precedence over `since`. |

Response (`Cache-Control: private, no-store`):

```json
{
  "results": [
    {
      "id": "…",
      "firstName": "…", "lastName": "…", "companyName": "…",
      "email": "…", "phone": "…",
      "addressLine1": "…", "addressLine2": "…", "city": "…", "zip": "…",
      "country": "…", "birthday": "…",
      "_discountGroupId": "…", "points": "…", "tags": ["…"],
      "created": "…", "versionDate": "2026-10-01T12:00:00.000Z",
      "deleted": false
    }
  ],
  "next_cursor": "from.1759320300000"
}
```

- `versionDate` is normalized to UTC ISO 8601, or `null` for an undated
  customer; other fields keep Dotypos values, and absent fields are `null`.
- `next_cursor` is `null` after the last page. A page can be empty while
  `next_cursor` is set; PostHog's cursor paginator stops only on an empty
  cursor.
- Deleted customers are included (`deleted|in|0,1`) with `deleted: true`.
- Rows can repeat across pages, never within one; PostHog merges them on `id`.

### Cursor

Dotypos filters customer `versionDate` with `eq`, `gt`, `gteq`, `null`, and
`notnull`, but filters `id` only with `eq` and `in`
([customer entity](https://docs.api.dotypos.com/entity/customer/),
[filtering](https://docs.api.dotypos.com/api-reference/general/filter/)).
Positions are therefore keyed on version dates, never on an offset into a
list that edits can shift. Every request reads exactly one Dotypos page.

| Cursor | Dotypos read |
| --- | --- |
| (none, no `since`) | `undated.1` |
| (none, `since`) | `versionDate\|gteq\|since`, page 1, sorted by `versionDate` |
| `undated.<page>[.<size>]` | `versionDate\|eq\|null`, that page, sorted by `id` |
| `dated` | `versionDate\|eq\|notnull`, page 1 |
| `from.<ms>` / `after.<ms>` | `versionDate\|gteq` / `gt`, page 1 |
| `at.<ms>.<page>[.<size>]` | `versionDate\|eq\|<ms>`, that page, sorted by `id` |

- A range page (`from`, `after`, `dated`) always reads page 1. When more
  pages follow, the last version date on the page may continue past it, so
  its customers are held back and the next cursor is `from.<that version>`.
  Every customer with an earlier version date is on the page, so none can be
  skipped. When a whole page shares one version date, the page is served and
  that version date is read as a group (`at.<ms>.1`).
- A group (`at`, `undated`) is paged by number because Dotypos can't compare
  IDs. Customers only leave a group whose version date is past: an edit moves
  them to a newer version date, which the sync reaches later. The first page
  records the group's `totalItemsCount` as `<size>`; a later page reporting
  another count, or an empty later page, restarts the group from page 1. A
  multi-page group without a count fails with 502 instead of risking a skip.
  After the group, the cursor continues with `after.<ms>`.
- Every page is checked against its selection: an undated customer on a dated
  page, a dated one on an undated page, or a version date out of order fails
  with 502, because continuing could skip customers silently.
- Group pages sort by `id`, which the Dotypos reference doesn't list as
  sortable. If Dotypos rejects it, group pages fail with 502; range pages sort
  by `versionDate` only.

### Undated customers

The Dotypos reference types customer `versionDate` as optional
(`timestamp?`), so it isn't proven non-null. Incremental syncs filter on
`versionDate` and can never reach an undated customer, so a first sync
(PostHog omits `since`) starts with them: it pages `versionDate|eq|null`, then
every dated customer. An undated customer edited meanwhile gains a version
date and is read among the dated ones. Undated rows carry `versionDate: null`.

### Statuses

400 for an invalid `since` or `cursor`, 401, 404, 429 with `Retry-After` when
the export budget is spent (see below) or Dotypos rate-limits (60 seconds),
502 for other Dotypos failures and the unsafe pages above, and 503 when the
budget store is unavailable. PostHog retries 429 and 5xx answers.

## Field allowlist

The response schema is the allowlist: `id`, `firstName`, `lastName`,
`companyName`, `email`, `phone`, `addressLine1`, `addressLine2`, `city`, `zip`,
`country`, `birthday`, `_discountGroupId`, `points`, `tags`, `created`,
`versionDate`, `deleted`. Rows are built field by field, and
`dotypos-customer-source.test.ts` pins the exact key set and checks that
excluded values never appear. Never export free-text fields (`note`,
`internalNote`, `headerPrint`), `barcode`, `companyId`, `companyId2`, `vatId`,
`externalId`, `flags`, `modifiedBy`, `_sellerId`, `display`, `hexColor`, or
`expireDate`. Adding a field needs the user's approval and a matching
privacy-policy update in `features/legal/content.tsx` (both locales).

## Export budget

Dotypos's manual states a limit of 150 requests per 30 minutes; the API
reference doesn't say what it counts. Live bookings use the same credentials,
so the export spends from its own budget before every Dotypos call:
`dotyposCustomerExportBudget` allows 3 requests per rolling 3 minutes, about
30 per 30 minutes. `RequestBudget` keeps one row per spend (budget key and
timestamp only) in `request_budget_spends` and serializes spends with a
transaction-scoped advisory lock, so the budget holds across serverless
instances. When it's spent, the route answers 429 with `Retry-After` set to
when the oldest spend leaves the window, without calling Dotypos.
`listCustomerChanges` never retries; an access-token exchange, when the
process has no cached token, isn't counted.

How PostHog handles 429 (its REST client at
[`rest_client.py`](https://github.com/PostHog/posthog/blob/7329e67e23d82b8f7738e9ae33ebaad5fc51c9da/products/warehouse_sources/backend/temporal/data_imports/sources/common/rest_source/rest_client.py)):
it retries 429 and 5xx up to 5 attempts per request, sleeps for
`Retry-After`, and gives each request a 600-second retry budget. A
`Retry-After` above 300 seconds fails the request at once. A failed request
fails the run; Temporal retries the run (up to 9 attempts for incremental
syncs) and the next scheduled sync runs regardless.

To tune the budget, change `limit` and `window` together:

- `limit / window` is the export's sustained rate. Keep it well below
  Dotypos's 5 requests per minute so bookings keep most of the quota.
- Keep `window` at 5 minutes or less. A longer window lets a burst produce a
  `Retry-After` above PostHog's 300-second cap, which fails the run instead of
  pacing it.
- `limit` is the burst that runs without waiting: an incremental sync of up to
  `limit × 100` changed customers finishes without a 429.

### First sync

PostHog keeps no cursor between runs, and a run that fails before it finishes
commits no watermark, so a failed first sync starts again from the first
page. The budget paces a first sync instead of failing it: each page beyond
the burst waits for one `Retry-After` of up to 3 minutes, well inside PostHog's
per-request limits, so about 15,000 customers (150 pages) take roughly two and
a half hours in one run. Temporal allows an incremental run a week. Should
the run fail anyway, for example on a Dotypos outage, the retried run starts
over at the same pace and the budget still caps what it takes from bookings.

## PostHog setup

In PostHog, open **Data pipelines → Sources → New source → Custom REST**:

1. Base URL: `https://workspace.deskohub.cz`.
2. Authentication: **Bearer token**, with the
   `ANALYTICS_WAREHOUSE_SOURCE_TOKEN` value. Enter it in PostHog directly;
   never paste it into chat, issues, or logs.
3. Add one stream named `dotypos_customers` (if PostHog prefixes the table
   name, use the name it shows in the steps below):
   - Path `/api/analytics-warehouse/dotypos-customers`, method `GET`.
   - Records JSONPath `results`.
   - Primary key `id`.
   - Pagination: **Cursor in JSON body** with cursor JSONPath `next_cursor`
     and cursor query parameter `cursor`.
4. Sync method: **Incremental**, cursor field `versionDate`, type
   **Datetime**, start query parameter `since`, upstream row order
   **Ascending**. Leave the initial value empty so the first sync reads every
   customer.
5. Sync frequency: **24 hours** by default. A shorter interval only adds
   requests against the shared Dotypos limit; the export budget caps them
   either way.
6. After the first sync, open the `persons` table in the data warehouse and
   add a join: source key `properties.dotypos_customer_id`, joining table
   `dotypos_customers`, joining key `id`, field name `dotypos_customer`.
7. Exclude deleted customers in SQL with `dotypos_customers.deleted = false`,
   and in person-based insights with the filter
   `persons.dotypos_customer.deleted = false`.

## Verification

Run the colocated tests in `features/analytics-warehouse/backend/`, the
`DotyposService customer changes` block in
`packages/dotypos/src/backend/service.test.ts`, and
`shared/backend/request-budget/request-budget.service.postgres.test.ts`
against a disposable Postgres. Never call the production
endpoint or production Dotypos to test this source; use synthetic fixtures.
