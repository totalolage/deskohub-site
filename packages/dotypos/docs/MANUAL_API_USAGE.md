# Dotypos Manual API Usage

Use this when you need to manually inspect Dotypos API data from the repo without adding throwaway scripts.

## Run From Workspace

Run manual commands from `apps/deskohub-workspace`. The workspace app keeps Dotypos configuration across multiple local env files, and Bun can load all of them for a one-off command:

```bash
bun --env-file=.env.development --env-file=.env.local --env-file=.env.development.local --eval '<script>'
```

Do not print env values. Check only whether required keys are present.

## Import Generated SDK

Import the generated Dotypos SDK from the workspace package instead of copying generated files or writing temporary scripts:

```ts
import { getAccessToken, getCustomers } from "@deskohub/dotypos/generated";
import { createClient } from "@deskohub/dotypos/generated/client/index";
```

The generated SDK exposes raw endpoint functions. Authenticate first with `getAccessToken`, then pass the bearer token to the endpoint you want to inspect.

## Query Customers

This command authenticates with the generated SDK, queries the customers endpoint, and prints only non-secret customer fields:

```bash
bun --env-file=.env.development --env-file=.env.local --env-file=.env.development.local --eval 'import { getAccessToken, getCustomers } from "@deskohub/dotypos/generated"; import { createClient } from "@deskohub/dotypos/generated/client/index"; const required = ["DOTYPOS_REFRESH_TOKEN", "DOTYPOS_CLOUD_ID", "DOTYPOS_API_URL"]; const missing = required.filter((key) => !process.env[key]); if (missing.length) throw new Error(`Missing Dotypos env: ${missing.join(", ")}`); const client = createClient({ baseUrl: process.env.DOTYPOS_API_URL }); const tokenResponse = await getAccessToken({ client, headers: { Authorization: `User ${process.env.DOTYPOS_REFRESH_TOKEN}` }, body: { _cloudId: process.env.DOTYPOS_CLOUD_ID }, throwOnError: true }); const customersResponse = await getCustomers({ client, headers: { Authorization: `Bearer ${tokenResponse.data.accessToken}` }, path: { cloudId: process.env.DOTYPOS_CLOUD_ID }, query: { page: 1, limit: 10 }, throwOnError: true }); const customers = customersResponse.data.data ?? []; console.log(JSON.stringify({ currentPage: customersResponse.data.currentPage, perPage: customersResponse.data.perPage, totalItemsOnPage: customersResponse.data.totalItemsOnPage, totalItemsCount: customersResponse.data.totalItemsCount, customers: customers.map((customer) => ({ id: customer.id, firstName: customer.firstName, lastName: customer.lastName, companyName: customer.companyName, email: customer.email, phone: customer.phone, discountGroupId: customer._discountGroupId, display: customer.display, deleted: customer.deleted })) }, null, 2));'
```

Adjust `query.page`, `query.limit`, or add `query.filter` for narrower customer inspection.

## Adapt To Other Endpoints

Keep the same generated-client setup and swap the endpoint import/call. For example, to inspect tables:

```bash
bun --env-file=.env.development --env-file=.env.local --env-file=.env.development.local --eval 'import { getAccessToken, getTables } from "@deskohub/dotypos/generated"; import { createClient } from "@deskohub/dotypos/generated/client/index"; const required = ["DOTYPOS_REFRESH_TOKEN", "DOTYPOS_CLOUD_ID", "DOTYPOS_API_URL"]; const missing = required.filter((key) => !process.env[key]); if (missing.length) throw new Error(`Missing Dotypos env: ${missing.join(", ")}`); const client = createClient({ baseUrl: process.env.DOTYPOS_API_URL }); const tokenResponse = await getAccessToken({ client, headers: { Authorization: `User ${process.env.DOTYPOS_REFRESH_TOKEN}` }, body: { _cloudId: process.env.DOTYPOS_CLOUD_ID }, throwOnError: true }); const tablesResponse = await getTables({ client, headers: { Authorization: `Bearer ${tokenResponse.data.accessToken}` }, path: { cloudId: process.env.DOTYPOS_CLOUD_ID }, query: { page: 1, limit: 100 }, throwOnError: true }); const tables = tablesResponse.data.data ?? []; const rows = tables.map((table) => ({ id: table.id, name: table.name, seats: table.seats, display: table.display, enabled: table.enabled, locationName: table.locationName, type: table.type, tags: table.tags ?? [] })).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })); console.log(JSON.stringify(rows, null, 2));'
```

Use the returned fields to understand how Dotypos currently represents API data, then apply filtering in application code rather than hardcoding assumptions in this document.

## Notes

- `bun --env-file=.env.development.local --eval ...` may not be enough because workspace test secrets are split across files.
- `bun --env-file=.env.development.local -p '...'` is useful for a yes/no env-load check, but do not print secret values.
- Generated SDK response validators run before data is returned. If a real API response fails validation, fix the OpenAPI schema and regenerate with `bun run generate:dotypos`.
