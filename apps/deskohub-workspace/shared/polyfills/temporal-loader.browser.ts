import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import { isTemporalComplete, requiredTemporalApis } from "./temporal-runtime";

/** The polyfill script's URL, set when `temporal-polyfill:build` bundles this. */
declare const TEMPORAL_POLYFILL_URL: string;

// Runs inline in `<head>`. `document.write` inserts a parser-blocking script,
// so the polyfill runs before the parser reaches the body script that starts
// the app, and so before any app module evaluates.
if (
  !isTemporalComplete(
    globalThis.Temporal,
    requiredTemporalApis,
    WORKSPACE_SITE_TIME_ZONE
  )
) {
  document.write(`<script src="${TEMPORAL_POLYFILL_URL}"></script>`);
}
