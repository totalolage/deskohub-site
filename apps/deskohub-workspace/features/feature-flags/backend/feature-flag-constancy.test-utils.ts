import type { WorkspaceFeatureFlagConstancy } from "./feature-flag-evaluation-mode.server";

/** How a classification that answered decides a flag with `value`. */
export const classifiedConstancy = (
  value: boolean | undefined
): WorkspaceFeatureFlagConstancy =>
  value === undefined ? { kind: "per-request" } : { kind: "constant", value };
