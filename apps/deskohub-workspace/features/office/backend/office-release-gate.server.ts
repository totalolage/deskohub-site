import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import {
  OfficeReleaseGate,
  officeReleaseRunPolicy,
} from "./office-release-gate";

const officeRequest = releaseGateForRequest(OfficeReleaseGate, {
  operation: "office.page-enabled",
  ...officeReleaseRunPolicy,
});

/**
 * The office release gate, decided at most once per server render, so the
 * page metadata, page content, and advertised prices share one evaluation.
 * The header, home page and FAQ read it in static shells, so it rejects
 * while PostHog can't decide the flag (`ReleaseGateRequest.decision`).
 */
export const isOfficePageEnabled = officeRequest.decision;

/** The office gate backed by the request's one decision. */
export const OfficeReleaseGateRequest = officeRequest.layer;
