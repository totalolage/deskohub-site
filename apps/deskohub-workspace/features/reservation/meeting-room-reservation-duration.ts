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

export const meetingRoomReservationDurations = [
  { unit: "hour", amount: 1 },
  { unit: "hour", amount: 4 },
  { unit: "day", amount: 1 },
] as const satisfies readonly MeetingRoomReservationDuration[];

export const meetingRoomReservationDurationKeySchema = Schema.Literals([
  "hour:1",
  "hour:4",
  "day:1",
]);

export type MeetingRoomReservationDurationKey =
  typeof meetingRoomReservationDurationKeySchema.Type;

const durationsByKey = {
  "hour:1": meetingRoomReservationDurations[0],
  "hour:4": meetingRoomReservationDurations[1],
  "day:1": meetingRoomReservationDurations[2],
} as const satisfies Record<
  MeetingRoomReservationDurationKey,
  MeetingRoomReservationDuration
>;

export const getMeetingRoomReservationDurationKey = ({
  amount,
  unit,
}: MeetingRoomReservationDuration): MeetingRoomReservationDurationKey => {
  if (unit === "day") return "day:1";
  return amount === 1 ? "hour:1" : "hour:4";
};

export const getMeetingRoomReservationDuration = (
  key: MeetingRoomReservationDurationKey
): MeetingRoomReservationDuration => durationsByKey[key];

export const isMeetingRoomWholeDayReservationDuration = (
  duration: MeetingRoomReservationDuration
) => duration.unit === "day";
