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
      "created": "…", "versionDate": "2026-10-01T12:00:00.123456Z",
      "deleted": false
    }
  ],
  "next_cursor": "from.1759320000123456"
}
```

- `versionDate` is normalized to UTC ISO 8601 with six fraction digits, or
  `null` for an undated customer (Dotypos sends `null` or omits it). Other
  fields keep Dotypos values, and absent fields are `null`.
- `next_cursor` is `null` after the last page. A page can be empty while
  `next_cursor` is set; PostHog's cursor paginator stops only on an empty
  cursor.
- Deleted customers are included (`deleted|in|0,1`) with `deleted: true`.
- Rows can repeat across pages, never within one; PostHog merges them on `id`.

### Cursor

Dotypos customer list facts this design rests on, checked against the
synthetic dev/preview cloud on 2026-10-16 (read-only probe; production wasn't
called):

- `sort=id` and `sort=-id` answer 400 ("unsupported sorting direction"), as
  does an unknown field. `versionDate`, `created`, their `-` forms, and
  `versionDate,created` sort.
- `id` filters only with `eq` and `in`
  ([customer entity](https://docs.api.dotypos.com/entity/customer/),
  [filtering](https://docs.api.dotypos.com/api-reference/general/filter/)).
- `versionDate` and `created` carry up to microsecond precision, with
  trailing zeros trimmed (`2026-05-30T16:04:35.74702Z`). Filters compare at
  microseconds. An ISO value with six fraction digits filters exactly
  (`eq`, `gt`, `gteq`); an epoch-millisecond value is read as that exact
  millisecond, so `eq|<ms>` misses sub-millisecond values and `gt|<ms>`
  includes them.
- `versionDate|eq|null` is accepted; the synthetic cloud has no undated
  customer, so how Dotypos encodes one is unobserved.
- Lists report `totalItemsCount` and `nextPage`; a filter matching nothing
  answers 404. No response carries rate-limit headers.

So every request reads page 1 of a selection, and positions move by narrowing
the selection, never by page number. `DotyposTimestamp` (`@deskohub/dotypos`)
holds microseconds; cursors carry them as epoch microseconds and filters send
them as six-digit ISO values.

| Cursor | Dotypos read (page 1) |
| --- | --- |
| (none, no `since`) | as `undated` |
| (none, `since`) | `versionDate\|gteq\|since`, sorted by `versionDate` |
| `undated[.<created>]` | `versionDate\|eq\|null[;created\|gteq\|<created>]`, sorted by `created` |
| `dated` | `versionDate\|eq\|notnull`, sorted by `versionDate` |
| `from.<version>` / `after.<version>` | `versionDate\|gteq` / `gt`, sorted by `versionDate` |
| `at.<version>[.<created>]` | `versionDate\|eq\|<version>[;created\|gteq\|<created>]`, sorted by `created` |

- A range page (`from`, `after`, `dated`) holds back its last version date
  when more pages follow, because that version date may continue past the
  page; the next cursor is `from.<that version>`. Every customer with an
  earlier version date is on the page, so none can be skipped. When a whole
  page shares one version date, the page is served and that version date is
  read as a group (`at.<version>`).
- A group (`at`, `undated`) is read the same way along `created`: a full page
  holds back its last creation time and continues at
  `at.<version>.<created>`. Customers only leave a group whose version date
  is past (an edit moves them to a newer version date, which the sync reaches
  later), and creation times don't change, so the boundary stays put. After
  the group, `undated` continues with `dated` and `at.<version>` with
  `after.<version>`.
- Every page is checked against its selection before any position advances:
  each timestamp readable, every customer inside the selection (dated or
  undated, at or after the bound, the group's exact version date), and the
  sort key non-decreasing from the cursor's bound. A violation, or an empty
  page that claims more follow, answers 502. So a Dotypos page that repeats
  earlier customers, like the round-2 review's `1-100, 1-100, 201-250`,
  fails instead of skipping.
- A full group page whose customers all share one creation time can't be
  split, so it answers 502 rather than guess. The sync stays stuck until one
  of those customers changes; see the assumptions below.
- PostHog's `since` is read from its millisecond start, a superset of the
  microsecond version date PostHog stored, so the boundary customers repeat
  rather than drop.

### Undated customers

The Dotypos reference types customer `versionDate` as optional
(`timestamp?`), and the contract accepts `null` or absence alike. Incremental
syncs filter on `versionDate` and can never reach an undated customer, so a
first sync (PostHog omits `since`) starts with them: it reads
`versionDate|eq|null` by `created`, then every dated customer. An undated
customer edited meanwhile gains a version date and is read among the dated
ones. Undated rows carry `versionDate: null`.

## Customer objection (opt-out)

Staff record a customer's objection by adding the `no-analytics` tag to the
customer in Dotypos. The next sync blanks the row in PostHog and marks it
deleted. PostHog merges rows on `id`, and the filter
`custom.dotypos_customers.deleted = false` drops the customer.

This relies on a tag edit bumping the customer's `versionDate`; that behavior
is unverified against production and shares the monotonic-`versionDate`
assumption described below. To force the change immediately, trigger a resync
in PostHog using the unverified UI path below.

Do not remove the tag later unless the customer withdraws the objection.

### Assumptions not verified against production

- Production behaves like the synthetic cloud above (sorting, microsecond
  filters, 404 for empty filters).
- Every undated customer has a `created` timestamp; one without fails its
  group page with 502.
- A tie group of 100 customers with identical `versionDate` and `created`
  blocks the sync with 502 when more customers with that `versionDate` follow
  it. A group of 100 that is last for its `versionDate` succeeds. Only groups
  of 101 or more always block. The synthetic cloud stamps each row separately
  (neighbors differ by microseconds).
- `versionDate` grows with each edit, so an edited customer never moves to an
  earlier, already-read position.

### Statuses

400 for an invalid `since` or `cursor`, 401, 404, 429 with `Retry-After` when
the export budget is spent (see below) or Dotypos rate-limits (60 seconds),
502 for other Dotypos failures (including a rejected sort or filter) and the
unsafe pages above, and 503 when the
budget store is unavailable. PostHog retries 429 and 5xx answers.

## Sync blocked by 502

### Symptom and diagnosis

PostHog's sync for `dotypos_customers` fails repeatedly because the source
returns 502. In Workspace logs, filter for
`operation=analyticsWarehouseDotyposCustomers` and `statusCode=502`. The
failure event is logged as `Dotypos customer source could not read Dotypos`.
For a Dotypos failure it carries the `dotyposFailureLogFields`:
`dotyposCode` (`dotypos-rejected` for a rejected sort or filter or an unusable
answer, `dotypos-unavailable` for an outage), `dotyposReason`,
`dotyposOperation`, `dotyposRequest`, and `dotyposHttpStatus` when the
failure carries a Dotypos HTTP status. Otherwise its `errorTag` is
`UnpageableDotyposCustomerGroup` when a timestamp group cannot be split, or
`UnexpectedDotyposCustomerPage` for a missing ID or a selection/order
violation.

The `position` field on the preceding `Dotypos customer source served a page`
event identifies the selection kind (`Undated`, `ChangedAt`, `ChangedFrom`,
and so on); `rowCount` and `hasNextPage` describe that completed page. The
Workspace failure event does not log the exact cursor. Use the PostHog run's
`cursor` or `since` request value to locate the blocked position, if shown.
Never print or copy customer data into logs, tickets, or chat.

### Known causes and remedies

1. A tie group of 100 customers shares the same `versionDate` and `created`,
   such as after a bulk import or bulk edit in Dotypos, and more customers with
   that `versionDate` follow it. A group of 100 that is last for its
   `versionDate` succeeds; groups of 101 or more always block because the next
   page cannot split that timestamp group. Editing one customer may not unblock
   a larger batch. Re-save the affected customers in smaller batches so their
   `versionDate` values differ, or implement a separately verified pagination
   fallback.
2. A customer has no `id`. Escalate to Dotypos support.
3. Dotypos returned an out-of-order or repeated page. Escalate to Dotypos
   support.

After the cause is fixed, run the PostHog sync again. A failed run has not
committed its watermark past the blocked page, so no rows were skipped.

**Unverified UI path:** try **Data pipelines → Sources → the Dotypos source →
`dotypos_customers` → Sync now**. PostHog's
[sync monitoring docs](https://posthog.com/docs/data-warehouse/monitoring)
describe finding failed runs but do not confirm this manual resync control or
its exact location.

## Field allowlist

The response schema is the allowlist: `id`, `firstName`, `lastName`,
`companyName`, `email`, `phone`, `addressLine1`, `addressLine2`, `city`, `zip`,
`country`, `birthday`, `_discountGroupId`, `points`, `tags`, `created`,
`versionDate`, `deleted`. These are JSON keys; PostHog snake-cases them for
warehouse columns, so `versionDate` becomes `version_date`, `firstName`
becomes `first_name`, `_discountGroupId` becomes `_discount_group_id`, and
`deleted` stays `deleted`. Rows are built field by field, and
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
3. Add one stream named `dotypos_customers`. PostHog stores the table as
   `custom.dotypos_customers` and snake-cases the JSON keys into column names:
   the incremental cursor is `version_date`, and the deletion flag is
   `deleted`.
   - Path `/api/analytics-warehouse/dotypos-customers`, method `GET`.
   - Records JSONPath `results`.
   - Primary key `id`.
   - Pagination: **Cursor in JSON body** with cursor JSONPath `next_cursor`
     and cursor query parameter `cursor`.
4. Sync method: **Incremental**, cursor field `version_date`, type
   **Datetime**, start query parameter `since`, upstream row order
   **Ascending**. Leave the initial value empty so the first sync reads every
   customer.
5. Sync frequency: **24 hours** by default. A shorter interval only adds
   requests against the shared Dotypos limit; the export budget caps them
   either way.
6. After the first sync, open the `persons` table in the data warehouse and
   add a join: source key `properties.dotypos_customer_id`, joining table
   `custom.dotypos_customers`, joining key `id`, field name
   `dotypos_customer`.
7. Exclude deleted customers in SQL with
   `custom.dotypos_customers.deleted = false`,
   and in person-based insights with the filter
   `persons.dotypos_customer.deleted = false`.

### Live setup recorded on 2026-10-16

- Source ID: `01a145ac-851a-0000-9b5d-9647ca72a295`.
- Schema ID: `01a145ac-853e-0000-11d9-da862d10d2f3`.
- Join ID: `01a145b0-4283-0000-7e73-8004e424ce6e`.
- First sync: 63 rows, 63 distinct IDs, 0 deleted.

### API setup notes

- The UI's upstream order **Ascending** maps to the manifest field
  `sort_mode: "asc"`.
- Creating the source through the API defaults its sync frequency to 6 hours.
  PATCH the schema to 24 hours after creating the source.

## Verification

Run the colocated tests in `features/analytics-warehouse/backend/`, the
`DotyposService customer changes` block in
`packages/dotypos/src/backend/service.test.ts`,
`packages/dotypos/src/timestamp.test.ts`, and
`shared/backend/request-budget/request-budget.service.postgres.test.ts`
against a disposable Postgres. Use synthetic fixtures by default; never call
production Dotypos to test this source. One explicitly authorized smoke
request to the production source endpoint is allowed. Record only the response
status, row count, and whether a cursor is present. Never print or save the
response body or row contents.
