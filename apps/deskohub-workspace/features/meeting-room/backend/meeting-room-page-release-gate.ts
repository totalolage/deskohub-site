import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";

/** `meeting_room_page`: the meeting-room page and the links to it. */
export class MeetingRoomPageReleaseGate extends ReleaseGate<MeetingRoomPageReleaseGate>()(
  "@deskohub-workspace/meeting-room/MeetingRoomPageReleaseGate",
  "meeting_room_page"
) {}
