import { releaseGateForRun } from "@/features/feature-flags/backend/release-gate-run";
import {
  OfficeReleaseGate,
  officeReleaseRunPolicy,
} from "./office-release-gate";

/**
 * The office gate decided once per build, for a request served outside
 * Next.js, such as the customer HTTP API. Build it once per request.
 */
export const OfficeReleaseGateForRun = releaseGateForRun(
  OfficeReleaseGate,
  officeReleaseRunPolicy
);
