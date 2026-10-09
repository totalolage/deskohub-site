import { Schema } from "effect";
import { isPlainDateString } from "@/shared/utils/temporal";
import {
  nexiOperationChannels,
  nexiOperationTypes,
} from "./payment-administration-filters";

const calendarDateField = Schema.String.check(isPlainDateString());
const optionalCalendarDateField = Schema.Union([
  Schema.Literal(""),
  calendarDateField,
]);

export const orderFilterSchema = Schema.Struct({
  from: optionalCalendarDateField,
  to: optionalCalendarDateField,
});

export type OrderFilterValues = typeof orderFilterSchema.Encoded;

export const bookingFilterSchema = Schema.Struct({
  date: calendarDateField,
  sort: Schema.Literals(["booking", "status"]),
  direction: Schema.Literals(["asc", "desc"]),
});

export type BookingFilterValues = typeof bookingFilterSchema.Encoded;

const optionalOperationChannelField = Schema.Union([
  Schema.Literal(""),
  Schema.Literals(nexiOperationChannels),
]);

const optionalOperationTypeField = Schema.Union([
  Schema.Literal(""),
  Schema.Literals(nexiOperationTypes),
]);

export const operationFilterSchema = Schema.Struct({
  from: optionalCalendarDateField,
  to: optionalCalendarDateField,
  channel: optionalOperationChannelField,
  operationType: optionalOperationTypeField,
});

export type OperationFilterValues = typeof operationFilterSchema.Encoded;

const optionalReservationStatusField = Schema.Union([
  Schema.Literal(""),
  Schema.Literals(["in_progress", "complete", "cancelled", "needs_refund"]),
]);

const optionalReservationTypeField = Schema.Union([
  Schema.Literal(""),
  Schema.Literals(["cowork", "meeting-room", "office"]),
]);

export const reservationFilterSchema = Schema.Struct({
  status: optionalReservationStatusField,
  type: optionalReservationTypeField,
  from: optionalCalendarDateField,
  to: optionalCalendarDateField,
  customerId: Schema.optional(Schema.String),
  sort: Schema.Literals(["created", "date", "reservation", "status"]),
  direction: Schema.Literals(["asc", "desc"]),
});

export type ReservationFilterValues = typeof reservationFilterSchema.Encoded;
