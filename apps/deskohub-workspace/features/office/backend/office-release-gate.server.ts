import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import { OfficeReleaseGate } from "./office-release-gate";

// A run that fails beyond the gate's own fail-closed policy, such as a
// runtime that cannot start, rejects, so the office page errors rather
// than answering not found.
const officeRequest = releaseGateForRequest(OfficeReleaseGate, {
  operation: "office.page-enabled",
  whenRunFails: "reject",
});

/**
 * The office release gate, decided at most once per server render, so the
 * page metadata, page content, and advertised prices share one evaluation.
 */
export const isOfficePageEnabled = officeRequest.isOpen;

/** The office gate backed by the request's one decision. */
export const OfficeReleaseGateRequest = officeRequest.layer;
