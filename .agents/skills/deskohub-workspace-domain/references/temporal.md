# Timezone and Temporal values

- Reuse the timezone, Temporal schemas, and formatters in [`shared/utils/site-constants.ts`](../../../../apps/deskohub-workspace/shared/utils/site-constants.ts) and [`shared/utils/temporal.ts`](../../../../apps/deskohub-workspace/shared/utils/temporal.ts). Don't redeclare them in feature modules.
- Reference `workspaceSiteConstants.location.timeZone` directly instead of exporting feature-level timezone aliases. Name site-local date helpers for their Workspace role, not for the city.
- Use the ambient `Temporal.*` types from the global alias in `types/temporal.d.ts`. Don't redeclare individual Temporal types or export type aliases for them.
- `instrumentation.ts` and `instrumentation-client.ts` install the Temporal runtime, so feature, route, and shared-component modules use the ambient `Temporal` and leave `shared/polyfills/temporal` to instrumentation. The exception is a module that reads `Temporal` while it loads (a top-level const, a static field, an immediately invoked function): Next collects page data at build time without running instrumentation, so that module imports `@/shared/polyfills/temporal` itself. [`shared/polyfills/temporal.test.ts`](../../../../apps/deskohub-workspace/shared/polyfills/temporal.test.ts) enforces this.
- Type each formatter to the representation it formats. Reservation facts use `Temporal.Instant`. Raw plain-date strings belong only in named form or input adapters. Never mix `Date`, `string`, and Temporal values in one reservation display formatter.
- Decode Dotypos reservation start and end values through the canonical reservation interval schema before projecting them. Don't add a parallel timestamp parser or accept response shapes the generated Dotypos client rejects.

## Stored instant precision

`Temporal.Now.instant()` carries nanoseconds, but `instant` columns store microseconds, so a persisted instant never `equals` the in-memory value it came from. Before comparing an in-memory instant, or one serialized into a queue payload or key, with a stored one, pass both through `toStoredInstant` from [`db/instant.ts`](../../../../apps/deskohub-workspace/db/instant.ts). Serialize such instants at stored precision.
