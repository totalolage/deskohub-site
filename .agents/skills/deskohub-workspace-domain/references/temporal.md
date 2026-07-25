# Timezone and Temporal values

Reuse the Workspace timezone and Temporal schemas and formatters from [site constants](../../../../apps/deskohub-workspace/shared/utils/site-constants.ts) and [Temporal utilities](../../../../apps/deskohub-workspace/shared/utils/temporal.ts). Do not redeclare them inside feature modules.

Reference `workspaceSiteConstants.location.timeZone` directly instead of exporting feature-level timezone aliases.

Use the ambient `Temporal.*` types. Keep the polyfill namespace exposed generically through the global alias in `types/temporal.d.ts`; do not manually redeclare individual Temporal types or export/import utility aliases for types provided by that namespace.

Keep formatting APIs typed to the domain representation they format. Actual
reservation facts use `Temporal.Instant`; raw plain-date strings belong only in
explicitly named form/input boundary adapters. Do not combine `Date`, `string`,
and Temporal values in one reservation display formatter.

Decode Dotypos reservation start/end values through the canonical reservation
interval schema before projecting them to application timing values. Do not add
a parallel timestamp parser or compatibility for response shapes rejected by
the generated Dotypos client.
