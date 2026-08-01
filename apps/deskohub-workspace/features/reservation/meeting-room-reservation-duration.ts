import { Schema } from "effect";
import {
  type WorkspaceMeetingRoomDurationKey,
  workspaceMeetingRoomCatalog,
  workspaceMeetingRoomProductsByDurationKey,
} from "@/features/checkout/meeting-room-product-catalog";

export const meetingRoomReservationDurationSchema = Schema.Union(
  workspaceMeetingRoomCatalog.map(({ durationSchema }) => durationSchema)
).annotate({
  identifier: "MeetingRoomReservationDuration",
  description:
    "A purchasable meeting-room period, preserving calendar-day semantics separately from elapsed hours.",
});

export type MeetingRoomReservationDuration =
  typeof meetingRoomReservationDurationSchema.Type;

export const meetingRoomReservationDurationKeys = Object.keys(
  workspaceMeetingRoomProductsByDurationKey
) as [WorkspaceMeetingRoomDurationKey, ...WorkspaceMeetingRoomDurationKey[]];

export const meetingRoomReservationDurationKeySchema = Schema.Literals(
  meetingRoomReservationDurationKeys
);

export type MeetingRoomReservationDurationKey = WorkspaceMeetingRoomDurationKey;

export const meetingRoomReservationDurations = workspaceMeetingRoomCatalog.map(
  ({ duration }) => duration
);

export const getMeetingRoomReservationDurationKey = ({
  amount,
  unit,
}: MeetingRoomReservationDuration): MeetingRoomReservationDurationKey =>
  `${unit}:${amount}` as MeetingRoomReservationDurationKey;

export const getMeetingRoomReservationDuration = (
  key: MeetingRoomReservationDurationKey
): MeetingRoomReservationDuration =>
  workspaceMeetingRoomProductsByDurationKey[key].duration;

export const isMeetingRoomWholeDayReservationDuration = (
  duration: MeetingRoomReservationDuration
) => duration.unit === "day";
