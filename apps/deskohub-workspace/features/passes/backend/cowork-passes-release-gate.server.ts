import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import { CoworkPassesReleaseGate } from "./cowork-passes-release-gate";

const coworkPassesRequest = releaseGateForRequest(CoworkPassesReleaseGate, {
  operation: "passes.cowork-passes-page-enabled",
  whenRunFails: "close",
  failureCode: "passes.cowork-passes-release-gate",
});

export const isCoworkPassesPageOpenAfterConnection = coworkPassesRequest.isOpen;
