import type { MeetingRoomReservationDurationKey } from "./meeting-room-reservation-duration";

// @ts-expect-error Cross-unit amounts that are absent from the catalog are invalid.
const unsupportedDurationKey: MeetingRoomReservationDurationKey = "day:4";

void unsupportedDurationKey;
