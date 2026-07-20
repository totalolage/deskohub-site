# Timezone and Temporal values

Reuse the Workspace timezone and Temporal schemas and formatters from [site constants](../../../../apps/deskohub-workspace/shared/utils/site-constants.ts) and [Temporal utilities](../../../../apps/deskohub-workspace/shared/utils/temporal.ts). Do not redeclare them inside feature modules.

Reference `workspaceSiteConstants.location.timeZone` directly instead of exporting feature-level timezone aliases.

Use the ambient `Temporal.*` instance types. Keep the polyfill's global class aliases in `types/temporal.d.ts`; do not export or import utility aliases for types provided by the Temporal namespace.
