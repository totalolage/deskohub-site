# Dotypos Manual API Usage

Use this when you need to manually inspect Dotypos data from the repo without adding throwaway scripts.

## Workspace Test Environment

The workspace app keeps Dotypos configuration across multiple local env files:

- `apps/deskohub-workspace/.env.development`
- `apps/deskohub-workspace/.env.local`
- `apps/deskohub-workspace/.env.development.local`

Load all three when running manual commands from `apps/deskohub-workspace`:

```bash
bun --env-file=.env.development --env-file=.env.local --env-file=.env.development.local --eval '<script>'
```

Do not print env values. Check only whether required keys are present.

## Prefer Direct Runtime Config

For manual package calls, avoid importing the workspace app `env` module unless you need full app validation. It validates unrelated variables and can fail before the Dotypos call runs.

Create a Dotypos config layer directly from `process.env`:

```ts
import { Effect, Layer } from "effect";
import {
  DotyposService,
  makeDotyposRuntimeConfigLayer,
} from "@deskohub/dotypos";

const required = [
  "DOTYPOS_CLIENT_ID",
  "DOTYPOS_CLIENT_SECRET",
  "DOTYPOS_REFRESH_TOKEN",
  "DOTYPOS_CLOUD_ID",
  "DOTYPOS_BRANCH_ID",
  "DOTYPOS_EMPLOYEE_ID",
  "DOTYPOS_API_URL",
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  throw new Error(`Missing Dotypos env: ${missing.join(", ")}`);
}

const configLayer = makeDotyposRuntimeConfigLayer({
  clientId: process.env.DOTYPOS_CLIENT_ID,
  clientSecret: process.env.DOTYPOS_CLIENT_SECRET,
  refreshToken: process.env.DOTYPOS_REFRESH_TOKEN,
  cloudId: process.env.DOTYPOS_CLOUD_ID,
  branchId: process.env.DOTYPOS_BRANCH_ID,
  employeeId: process.env.DOTYPOS_EMPLOYEE_ID,
  apiUrl: process.env.DOTYPOS_API_URL,
  apiTimeout: Number(process.env.DOTYPOS_API_TIMEOUT ?? 5000),
  reservationTableIds: [],
});
```

## Pull Tables

This command prints only non-secret table fields. Adjust the projection for the specific API data you need to inspect:

```bash
bun --env-file=.env.development --env-file=.env.local --env-file=.env.development.local --eval 'import { Effect, Layer } from "effect"; import { DotyposService, makeDotyposRuntimeConfigLayer } from "@deskohub/dotypos"; const required = ["DOTYPOS_CLIENT_ID", "DOTYPOS_CLIENT_SECRET", "DOTYPOS_REFRESH_TOKEN", "DOTYPOS_CLOUD_ID", "DOTYPOS_BRANCH_ID", "DOTYPOS_EMPLOYEE_ID", "DOTYPOS_API_URL"]; const missing = required.filter((key) => !process.env[key]); if (missing.length) throw new Error(`Missing Dotypos env: ${missing.join(", ")}`); const configLayer = makeDotyposRuntimeConfigLayer({ clientId: process.env.DOTYPOS_CLIENT_ID, clientSecret: process.env.DOTYPOS_CLIENT_SECRET, refreshToken: process.env.DOTYPOS_REFRESH_TOKEN, cloudId: process.env.DOTYPOS_CLOUD_ID, branchId: process.env.DOTYPOS_BRANCH_ID, employeeId: process.env.DOTYPOS_EMPLOYEE_ID, apiUrl: process.env.DOTYPOS_API_URL, apiTimeout: Number(process.env.DOTYPOS_API_TIMEOUT ?? 5000), reservationTableIds: [] }); const tables = await Effect.runPromise(Effect.gen(function* () { const dotypos = yield* DotyposService; return yield* dotypos.getTables(); }).pipe(Effect.provide(Layer.provide(DotyposService.Default, configLayer)))); const rows = tables.map((table) => ({ id: table.id, name: table.name, seats: table.seats, display: table.display, enabled: table.enabled, locationName: table.locationName, type: table.type, tags: table.tags ?? [] })).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })); console.log(JSON.stringify(rows, null, 2));'
```

Use the returned table fields to understand how Dotypos currently represents tables, then apply filtering in application code rather than hardcoding assumptions in this document.

## Notes

- `bun --env-file=.env.development.local --eval ...` may not be enough because workspace test secrets are split across files.
- `bun --env-file=.env.development.local -p '...'` is useful for a yes/no env-load check, but do not print secret values.
- If the workspace `env` module reports missing unrelated variables, switch to the direct `makeDotyposRuntimeConfigLayer` approach above.
