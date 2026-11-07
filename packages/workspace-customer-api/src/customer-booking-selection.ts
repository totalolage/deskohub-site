import { Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

/** A Prague calendar date, YYYY-MM-DD. */
export const CustomerPlainDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)
).annotate({
  identifier: "CustomerPlainDate",
  description: "Prague calendar date in YYYY-MM-DD format.",
});

export const CustomerReservationFamily = Schema.Literals([
  "cowork",
  "meeting-room",
  "office",
]).annotate({ identifier: "CustomerReservationFamily" });
export type CustomerReservationFamily = typeof CustomerReservationFamily.Type;

/** The cowork tiers a customer can book now. */
export const CustomerBookableCoworkTier = Schema.Literals([
  "open-space",
  "reserved-desk",
]).annotate({ identifier: "CustomerBookableCoworkTier" });
export type CustomerBookableCoworkTier = typeof CustomerBookableCoworkTier.Type;

export const CustomerMonitorOption = Schema.Literals([
  "2x27-qhd",
  "2x32-qhd",
  "2x27-4k",
  "2x32-4k",
]).annotate({ identifier: "CustomerMonitorOption" });
export type CustomerMonitorOption = typeof CustomerMonitorOption.Type;

export const CustomerMeetingRoomDuration = Schema.Literals([
  "hour:1",
  "hour:4",
  "day:1",
]).annotate({
  identifier: "CustomerMeetingRoomDuration",
  description:
    "hour:1 (one hour), hour:4 (four hours), or day:1 (a whole Prague calendar day).",
});
export type CustomerMeetingRoomDuration =
  typeof CustomerMeetingRoomDuration.Type;

/** A Prague time of day on the hour, HH:mm. */
export const CustomerStartTime = Schema.String.check(
  Schema.isPattern(/^\d{2}:\d{2}$/)
).annotate({
  identifier: "CustomerStartTime",
  description: "Prague start time in HH:mm, such as 09:00.",
});

const officeSeats = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** The fields a selection's query string carries alike in every encoding. */
const selectionFields = {
  family: CustomerReservationFamily,
  /** For an office, the first date. */
  date: CustomerPlainDate,
  /** Office only: the last date, inclusive. Defaults to `date`. */
  endDate: Schema.optionalKey(CustomerPlainDate),
  /** Meeting room only, except for the whole-day booking. */
  startTime: Schema.optionalKey(CustomerStartTime),
  /** Meeting room only. */
  duration: Schema.optionalKey(CustomerMeetingRoomDuration),
  /** Cowork only, required. */
  tier: Schema.optionalKey(CustomerBookableCoworkTier),
  /** Cowork Reserved Desk only: a monitor workstation configuration. */
  monitorOption: Schema.optionalKey(CustomerMonitorOption),
};

/**
 * One complete, priceable booking: a cowork tier and date, a meeting-room
 * start and duration, or office dates and seats. The server checks it the way
 * the booking pages accept it.
 */
export const CustomerBookingSelection = Schema.Struct({
  ...selectionFields,
  /** Office only: the number of seats. Defaults to 1. */
  seats: Schema.optionalKey(officeSeats),
  /** Cowork Open Space only: add coffee. Reserved Desk includes it. */
  coffee: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "CustomerBookingSelection" });
export type CustomerBookingSelection = typeof CustomerBookingSelection.Type;

/** `CustomerBookingSelection` as a GET request's query string carries it. */
export const CustomerBookingSelectionQuery = Schema.Struct({
  ...selectionFields,
  seats: Schema.optionalKey(
    Schema.FiniteFromString.pipe(Schema.decodeTo(officeSeats))
  ),
  coffee: Schema.optionalKey(Schema.Literals(["true", "false"])),
});

// Errors

/**
 * The selection or query doesn't name a booking the product offers: a field
 * a family needs is missing, or one it doesn't take is set. `field` names it
 * when one does.
 */
export class CustomerBookingSelectionInvalid extends Schema.TaggedErrorClass<CustomerBookingSelectionInvalid>()(
  "CustomerBookingSelectionInvalid",
  { field: Schema.optionalKey(Schema.String) }
) {
  static schema = this.pipe(HttpApiSchema.status("BadRequest"));
}

/** The date is outside what can be booked now: from `earliest` to `latest`. */
export class CustomerBookingDateOutOfRange extends Schema.TaggedErrorClass<CustomerBookingDateOutOfRange>()(
  "CustomerBookingDateOutOfRange",
  { earliest: CustomerPlainDate, latest: CustomerPlainDate }
) {
  static schema = this.pipe(HttpApiSchema.status("UnprocessableEntity"));
}

/** The family can't be booked now, such as while office reservations are closed. */
export class CustomerOfferingUnavailable extends Schema.TaggedErrorClass<CustomerOfferingUnavailable>()(
  "CustomerOfferingUnavailable",
  { family: Schema.Literal("office") }
) {
  static schema = this.pipe(HttpApiSchema.status("NotFound"));
}
