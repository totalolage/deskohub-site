# Timezone and Temporal values

Reuse the Workspace timezone and Temporal schemas and formatters from [site constants](../../../../apps/deskohub-workspace/shared/utils/site-constants.ts) and [Temporal utilities](../../../../apps/deskohub-workspace/shared/utils/temporal.ts). Do not redeclare them inside feature modules.

Reference `workspaceSiteConstants.location.timeZone` directly instead of exporting feature-level timezone aliases.

Use the ambient `Temporal.*` types. Keep the polyfill namespace exposed generically through the global alias in `types/temporal.d.ts`; do not manually redeclare individual Temporal types or export/import utility aliases for types provided by that namespace.
