import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import { MeetingRoomPageReleaseGate } from "./meeting-room-page-release-gate";

// A run that fails beyond the gate's own fail-closed policy, such as a
// runtime that cannot start, rejects, so the page errors rather than
// answering not found.
const meetingRoomPageRequest = releaseGateForRequest(
  MeetingRoomPageReleaseGate,
  { operation: "meeting-room.page-enabled", whenRunFails: "reject" }
);

/**
 * The meeting-room page release gate, decided at most once per server
 * render, so the page metadata, page content, header, and landing hero
 * share one evaluation.
 */
export const isMeetingRoomPageEnabled = meetingRoomPageRequest.isOpen;

/** The meeting-room page gate backed by the request's one decision. */
export const MeetingRoomPageReleaseGateRequest = meetingRoomPageRequest.layer;
