import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import { SiteToolsReleaseGate } from "./site-tools-release-gate";

// Any run failure, including a defect or a runtime that cannot start,
// keeps the site tools off.
const siteToolsRequest = releaseGateForRequest(SiteToolsReleaseGate, {
  operation: "agent-tools.site-tools-enabled",
  whenRunFails: "close",
  failureCode: "site_tools_feature_flag_unavailable",
});

/** Whether the site tools register for this request. */
export const areSiteToolsEnabled = siteToolsRequest.isOpen;
