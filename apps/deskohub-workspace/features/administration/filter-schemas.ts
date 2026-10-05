import type { StandardSchemaV1 } from "@standard-schema/spec";
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

export const orderFilterSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    from: optionalCalendarDateField,
    to: optionalCalendarDateField,
  })
);

export type OrderFilterValues = StandardSchemaV1.InferInput<
  typeof orderFilterSchema
>;

export const bookingFilterSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    date: calendarDateField,
    sort: Schema.Literals(["booking", "status"]),
    direction: Schema.Literals(["asc", "desc"]),
  })
);

export type BookingFilterValues = StandardSchemaV1.InferInput<
  typeof bookingFilterSchema
>;

const optionalOperationChannelField = Schema.Union([
  Schema.Literal(""),
  Schema.Literals(nexiOperationChannels),
]);

const optionalOperationTypeField = Schema.Union([
  Schema.Literal(""),
  Schema.Literals(nexiOperationTypes),
]);

export const operationFilterSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    from: optionalCalendarDateField,
    to: optionalCalendarDateField,
    channel: optionalOperationChannelField,
    operationType: optionalOperationTypeField,
  })
);

export type OperationFilterValues = StandardSchemaV1.InferInput<
  typeof operationFilterSchema
>;

const optionalReservationStatusField = Schema.Union([
  Schema.Literal(""),
  Schema.Literals(["in_progress", "complete", "cancelled"]),
]);

const optionalReservationTypeField = Schema.Union([
  Schema.Literal(""),
  Schema.Literals(["cowork", "meeting-room", "office"]),
]);

export const reservationFilterSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    status: optionalReservationStatusField,
    type: optionalReservationTypeField,
    from: optionalCalendarDateField,
    to: optionalCalendarDateField,
    customerId: Schema.optional(Schema.String),
    sort: Schema.Literals(["created", "date", "reservation", "status"]),
    direction: Schema.Literals(["asc", "desc"]),
  })
);

export type ReservationFilterValues = StandardSchemaV1.InferInput<
  typeof reservationFilterSchema
>;
