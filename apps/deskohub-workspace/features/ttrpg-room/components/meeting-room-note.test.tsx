import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ReleaseGateUnavailableError } from "@/features/feature-flags/backend/release-gate";

// The note renders after `connection()`, so it is never stored: it reads the
// gate's fail-closed answer, never the decision for stored output.
let gate: "open" | "closed" | "unavailable" = "open";
const unavailable = () =>
  new ReleaseGateUnavailableError({
    flags: ["meeting_room_page"],
    message: "PostHog couldn't decide the release gate.",
  });

mock.module("next/server", () => ({ connection: () => Promise.resolve() }));
mock.module(
  "@/features/meeting-room/backend/meeting-room-page-release-gate.server",
  () => ({
    isMeetingRoomPageEnabled: () =>
      gate === "unavailable"
        ? Promise.reject(unavailable())
        : Promise.resolve(gate === "open"),
    isMeetingRoomPageOpenAfterConnection: () =>
      Promise.resolve(gate === "open"),
  })
);

const { MeetingRoomNote } = await import("./meeting-room-note");

beforeEach(() => {
  gate = "open";
});

describe("MeetingRoomNote", () => {
  test("points at the meeting room while its page is published", async () => {
    expect(await MeetingRoomNote({ locale: "en-US" })).not.toBeNull();
  });

  test("is left out, not failed, while PostHog can't decide the meeting-room gate", async () => {
    for (const state of ["closed", "unavailable"] as const) {
      gate = state;
      expect(await MeetingRoomNote({ locale: "en-US" })).toBeNull();
    }
  });
});
