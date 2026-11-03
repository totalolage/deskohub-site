import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";

/** `seating_map`: table assignment from the seating map. */
export class SeatingMapReleaseGate extends ReleaseGate<SeatingMapReleaseGate>()(
  "@deskohub-workspace/reservation/SeatingMapReleaseGate",
  "seating_map"
) {}
