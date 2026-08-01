import { Schema } from "effect";

const meetingRoomHourlyReservationDurationSchema = Schema.Struct({
  unit: Schema.Literal("hour"),
  amount: Schema.Literals([1, 4]),
});

const meetingRoomWholeDayReservationDurationSchema = Schema.Struct({
  unit: Schema.Literal("day"),
  amount: Schema.Literal(1),
});

export const meetingRoomReservationDurationSchema = Schema.Union([
  meetingRoomHourlyReservationDurationSchema,
  meetingRoomWholeDayReservationDurationSchema,
]).annotate({
  identifier: "MeetingRoomReservationDuration",
  description:
    "A purchasable meeting-room period, preserving calendar-day semantics separately from elapsed hours.",
});

export type MeetingRoomReservationDuration =
  typeof meetingRoomReservationDurationSchema.Type;

export const meetingRoomReservationDurationKeys = [
  "hour:1",
  "hour:4",
  "day:1",
] as const;

export const meetingRoomReservationDurationKeySchema = Schema.Literals(
  meetingRoomReservationDurationKeys
);

export type MeetingRoomReservationDurationKey =
  typeof meetingRoomReservationDurationKeySchema.Type;

const durationsByKey = {
  "hour:1": { unit: "hour", amount: 1 },
  "hour:4": { unit: "hour", amount: 4 },
  "day:1": { unit: "day", amount: 1 },
} as const satisfies Record<
  MeetingRoomReservationDurationKey,
  MeetingRoomReservationDuration
>;

export const meetingRoomReservationDurations =
  meetingRoomReservationDurationKeys.map((key) => durationsByKey[key]);

export const getMeetingRoomReservationDurationKey = ({
  amount,
  unit,
}: MeetingRoomReservationDuration): MeetingRoomReservationDurationKey =>
  `${unit}:${amount}` as MeetingRoomReservationDurationKey;

export const getMeetingRoomReservationDuration = (
  key: MeetingRoomReservationDurationKey
): MeetingRoomReservationDuration => durationsByKey[key];

export const isMeetingRoomWholeDayReservationDuration = (
  duration: MeetingRoomReservationDuration
) => duration.unit === "day";
