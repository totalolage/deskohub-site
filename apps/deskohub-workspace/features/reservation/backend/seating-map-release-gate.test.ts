import { expect, test } from "bun:test";
import { decideReleaseGateOnlyFor } from "@/features/feature-flags/backend/release-gate.test-utils";
import { SeatingMapReleaseGate } from "./seating-map-release-gate";

test("opens on the seating_map flag", async () => {
  expect(
    await decideReleaseGateOnlyFor(SeatingMapReleaseGate, "seating_map")
  ).toEqual({
    isOpen: true,
    release: "on",
    lookups: [
      ["isEnabled", "seating_map"],
      ["constantValue", "seating_map"],
    ],
  });
});
