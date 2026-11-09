import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import { isTemporalComplete, requiredTemporalApis } from "./temporal-runtime";

/**
 * The browser entry asserts what the `<head>` loader guarantees: a complete
 * Temporal before any app module evaluates. Client code never bundles the
 * polyfill itself.
 */
if (
  !isTemporalComplete(
    globalThis.Temporal,
    requiredTemporalApis,
    WORKSPACE_SITE_TIME_ZONE
  )
) {
  throw new Error(
    "Temporal is missing or incomplete: the <head> loader didn't install the polyfill."
  );
}
