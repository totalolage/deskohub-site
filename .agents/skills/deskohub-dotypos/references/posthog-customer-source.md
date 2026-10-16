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
  "next_cursor": "1759320000000.2"
}
```

- Rows are ordered by `versionDate`, then `id`. `versionDate` is normalized to
  UTC ISO 8601; other fields keep Dotypos values, and absent fields are `null`.
- `next_cursor` is `null` after the last page. A cursor holds the last served
  version date (epoch milliseconds) and how many customers with exactly that
  version date were served, so a customer edited mid-sync doesn't shift the
  rest of the list.
- Deleted customers are included (`deleted|in|0,1`) with `deleted: true`.
- Statuses: 400 for an invalid `since` or `cursor`, 401, 404, 429 when Dotypos
  rate-limits, and 502 for other Dotypos failures. PostHog retries 429 and 5xx
  answers with backoff and fails the sync on other 4xx answers.

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

## Rate limit

Each request reads one Dotypos page of up to 100 customers, plus an access
token exchange when the process has no cached token. `listCustomerChanges`
never retries; PostHog's retry is the only retry. The Dotypos manual states a
limit of 150 requests per 30 minutes; the API reference doesn't confirm it or
say what it counts. If it applies, the source shares it with the rest of the
app. A first full sync of N customers costs about N/100 requests, and an
incremental sync costs one request per 100 changed customers.

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
   requests against the shared Dotypos limit.
6. After the first sync, open the `persons` table in the data warehouse and
   add a join: source key `properties.dotypos_customer_id`, joining table
   `dotypos_customers`, joining key `id`, field name `dotypos_customer`.
7. Exclude deleted customers in SQL with `dotypos_customers.deleted = false`,
   and in person-based insights with the filter
   `persons.dotypos_customer.deleted = false`.

## Verification

Run the colocated tests in `features/analytics-warehouse/backend/` and the
`DotyposService customer changes` block in
`packages/dotypos/src/backend/service.test.ts`. Never call the production
endpoint or production Dotypos to test this source; use synthetic fixtures.
