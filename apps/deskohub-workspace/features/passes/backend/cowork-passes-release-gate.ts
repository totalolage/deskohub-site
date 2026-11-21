import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";
import { releaseGateForRun } from "@/features/feature-flags/backend/release-gate-run";

export class CoworkPassesReleaseGate extends ReleaseGate<CoworkPassesReleaseGate>()(
  "@deskohub-workspace/passes/CoworkPassesReleaseGate",
  "cowork_passes"
) {}

export const CoworkPassesReleaseGateForRun = releaseGateForRun(
  CoworkPassesReleaseGate,
  {
    whenRunFails: "close",
    failureCode: "passes.cowork-passes-release-gate",
  }
);
