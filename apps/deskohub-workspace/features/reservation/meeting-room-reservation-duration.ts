import { Match, Schema, Struct } from "effect";
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

export const meetingRoomReservationDurationKeys = Struct.keys(
  workspaceMeetingRoomProductsByDurationKey
);

export const meetingRoomReservationDurationKeySchema = Schema.Literals(
  meetingRoomReservationDurationKeys
);

export type MeetingRoomReservationDurationKey = WorkspaceMeetingRoomDurationKey;

type MeetingRoomReservationDurationKeyForUnit<
  Unit extends MeetingRoomReservationDuration["unit"],
> = Extract<WorkspaceMeetingRoomDurationKey, `${Unit}:${number}`>;

export const meetingRoomReservationDurations = workspaceMeetingRoomCatalog.map(
  ({ duration }) => duration
);

export const getMeetingRoomReservationDurationKey =
  Match.type<MeetingRoomReservationDuration>().pipe(
    Match.discriminatorsExhaustive("unit")({
      day: ({ amount }): MeetingRoomReservationDurationKeyForUnit<"day"> =>
        `day:${amount}`,
      hour: ({ amount }): MeetingRoomReservationDurationKeyForUnit<"hour"> =>
        `hour:${amount}`,
    })
  );

export const getMeetingRoomReservationDuration = (
  key: MeetingRoomReservationDurationKey
): MeetingRoomReservationDuration =>
  workspaceMeetingRoomProductsByDurationKey[key].duration;

export const isMeetingRoomWholeDayReservationDuration = (
  duration: MeetingRoomReservationDuration
) => duration.unit === "day";
