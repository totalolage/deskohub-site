import type { GoogleCalendarEvent } from "@deskohub/google-calendar";
import { Data, Effect, Option, Schema } from "effect";
import type { SalesCalendarId } from "@/shared/backend/config/calendar-resource.config";
import {
  plainDateStringSchema,
  temporalInstantToIsoString,
  workspaceSiteConstants,
} from "@/shared/utils";
import { temporalInstantToPlainDate } from "@/shared/utils/temporal";
import {
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "./persistence-contracts";
import { logDiscountResolutionFailure } from "./resolution-logging";

const calendarEventReferenceSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CalendarEventReference")
).annotate({
  identifier: "CalendarEventReference",
  description: "Private stable reference of a Google Calendar event.",
});

const calendarSaleOccurrenceReferenceSchema = Schema.NonEmptyString.pipe(
  Schema.brand("CalendarSaleOccurrenceReference")
).annotate({
  identifier: "CalendarSaleOccurrenceReference",
  description:
    "Private stable reference of one Google Calendar sale occurrence.",
});

const calendarSaleEventMetadataSchema = Schema.Struct({
  eventReference: calendarEventReferenceSchema,
  title: Schema.Trim.check(Schema.isNonEmpty()),
  startDate: plainDateStringSchema,
  endDate: plainDateStringSchema,
  isAllDay: Schema.Literal(true),
}).check(
  Schema.makeFilter(
    ({ startDate, endDate }) =>
      Temporal.PlainDate.compare(startDate, endDate) < 0 || {
        path: ["endDate"],
        issue: "the exclusive end date must be after the start date",
      }
  )
);

type CalendarEventReference = Schema.Schema.Type<
  typeof calendarEventReferenceSchema
>;

type CalendarSaleOccurrenceReference = Schema.Schema.Type<
  typeof calendarSaleOccurrenceReferenceSchema
>;

type CalendarSaleConfigurationFailureReason =
  | "invalid_event"
  | "invalid_occurrence_reference"
  | "invalid_discount_reference";

export class CalendarSaleConfigurationError extends Data.TaggedError(
  "CalendarSaleConfigurationError"
)<{
  readonly reason: CalendarSaleConfigurationFailureReason;
  readonly message: string;
  readonly eventReference?: CalendarEventReference;
  readonly cause?: unknown;
}> {}

export type CalendarSale = {
  readonly calendarId: SalesCalendarId;
  readonly eventReference: CalendarEventReference;
  readonly occurrenceReference: CalendarSaleOccurrenceReference;
  readonly occurrenceDate: string;
  readonly discountId: StoredDiscountId;
  /** First instant at which a booking can receive the sale. */
  readonly startsAt: string;
  /** Exclusive end of the booking window; also the advertised expiry. */
  readonly expiresAt: string;
  readonly countdownStartsAt: string;
  /** Last service date the sale covers. */
  readonly lastDay: string;
};

/**
 * A booking made at `bookedAt` falls within the sale's booking window.
 */
export const isCalendarSaleBookableAt = (
  sale: Pick<CalendarSale, "startsAt" | "expiresAt">,
  bookedAt: Temporal.Instant
) =>
  Temporal.Instant.compare(sale.startsAt, bookedAt) <= 0 &&
  Temporal.Instant.compare(bookedAt, sale.expiresAt) < 0;

/**
 * A calendar sale applies only to bookings made during the sale whose last
 * service date is not after the sale's last day. Earlier service dates are
 * covered; a booking whose service range extends past the sale's last day gets
 * no sale at all.
 */
export const calendarSaleAppliesToBooking = (input: {
  readonly sale: Pick<CalendarSale, "startsAt" | "expiresAt" | "lastDay">;
  readonly bookedAt: Temporal.Instant;
  readonly lastServiceDate: string;
}) =>
  isCalendarSaleBookableAt(input.sale, input.bookedAt) &&
  Temporal.PlainDate.compare(input.lastServiceDate, input.sale.lastDay) <= 0;

/**
 * Workspace calendar date on which a booking made at `bookedAt` happens.
 */
export const getCalendarSaleBookingDate = (bookedAt: Temporal.Instant) =>
  temporalInstantToPlainDate({
    instant: bookedAt,
    timeZone: workspaceSiteConstants.location.timeZone,
  }).toString();

export const normalizeCalendarSales = Effect.fn("CalendarSale.normalizeAll")(
  (input: {
    readonly calendarId: SalesCalendarId;
    readonly events: readonly GoogleCalendarEvent[];
    readonly bookingDate: string;
  }) =>
    Effect.succeed(input).pipe(
      Effect.bind("results", ({ events, ...context }) =>
        Effect.forEach(events, (event) =>
          normalizeCalendarSale({ ...context, event }).pipe(
            Effect.matchEffect({
              onFailure: (cause) =>
                logDiscountResolutionFailure({
                  cause,
                  operation: "normalize",
                  provider: "calendar",
                }).pipe(
                  Effect.as({
                    sale: Option.none<CalendarSale>(),
                    failed: true,
                  })
                ),
              onSuccess: (sale) => Effect.succeed({ sale, failed: false }),
            })
          )
        )
      ),
      Effect.map(({ results }) => ({
        sales: results.flatMap(({ sale }) => Option.toArray(sale)),
        hasFailures: results.some(({ failed }) => failed),
      }))
    )
);

const normalizeCalendarSale = (input: {
  readonly calendarId: SalesCalendarId;
  readonly event: GoogleCalendarEvent;
  readonly bookingDate: string;
}): Effect.Effect<
  Option.Option<CalendarSale>,
  CalendarSaleConfigurationError
> => {
  if (input.event.status === "cancelled") {
    return Effect.succeed(Option.none());
  }

  return extractStoredDiscountId(input.event).pipe(
    Effect.map(
      Option.map((discountId) =>
        Effect.succeed({ ...input, discountId }).pipe(
          Effect.bind("metadata", decodeCalendarSaleEventMetadata),
          Effect.bind("occurrence", getCalendarSaleOccurrence),
          Effect.let("sale", toCalendarSale),
          Effect.map(({ metadata, bookingDate, sale }) =>
            isBookingDateCovered({ metadata, bookingDate })
              ? Option.some(sale)
              : Option.none()
          )
        )
      )
    ),
    Effect.flatMap(Effect.transposeOption),
    Effect.map(Option.flatten)
  );
};

const extractStoredDiscountId = (
  event: GoogleCalendarEvent
): Effect.Effect<
  Option.Option<StoredDiscountId>,
  CalendarSaleConfigurationError
> => {
  return Option.fromNullishOr(event.description).pipe(
    Option.map((description) => description.trim()),
    Option.filter((description) => description.length > 0),
    Option.map((description) =>
      Schema.decodeUnknownEffect(storedDiscountIdSchema)(
        description.toLowerCase()
      ).pipe(
        Effect.mapError(
          (cause) =>
            new CalendarSaleConfigurationError({
              reason: "invalid_discount_reference",
              message:
                "Calendar sale description must contain exactly one valid discount UUID and no other content.",
              ...getErrorEventReference(event),
              cause,
            })
        )
      )
    ),
    Effect.transposeOption
  );
};

const decodeCalendarSaleEventMetadata = (input: {
  readonly event: GoogleCalendarEvent;
}) =>
  Schema.decodeUnknownEffect(calendarSaleEventMetadataSchema, {
    errors: "all",
  })({
    eventReference: input.event.id ?? input.event.iCalUID ?? "",
    title: input.event.summary ?? "",
    startDate: input.event.start?.date ?? "",
    endDate: input.event.end?.date ?? "",
    isAllDay:
      input.event.start?.dateTime === undefined &&
      input.event.end?.dateTime === undefined,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CalendarSaleConfigurationError({
          reason: "invalid_event",
          message:
            "Calendar sale requires a stable event ID, a non-empty title, and valid all-day dates.",
          ...getErrorEventReference(input.event),
          cause,
        })
    )
  );

const getCalendarSaleOccurrence = (input: {
  readonly calendarId: SalesCalendarId;
  readonly event: GoogleCalendarEvent;
  readonly metadata: {
    readonly eventReference: CalendarEventReference;
    readonly startDate: Schema.Schema.Type<typeof plainDateStringSchema>;
  };
}) => {
  if (!input.event.recurringEventId) {
    const occurrenceDate = input.metadata.startDate;
    const stableReference = input.event.id
      ? input.metadata.eventReference
      : `${input.metadata.eventReference}:${occurrenceDate}`;

    return Effect.succeed({
      occurrenceDate,
      occurrenceReference: decodeCalendarSaleOccurrenceReference(
        `${input.calendarId}:${stableReference}`
      ),
    });
  }

  return Schema.decodeUnknownEffect(plainDateStringSchema)(
    input.event.originalStartTime?.date
  ).pipe(
    Effect.map((occurrenceDate) => ({
      occurrenceDate,
      occurrenceReference: decodeCalendarSaleOccurrenceReference(
        `${input.calendarId}:${input.event.recurringEventId}:${occurrenceDate}`
      ),
    })),
    Effect.mapError(
      (cause) =>
        new CalendarSaleConfigurationError({
          reason: "invalid_occurrence_reference",
          message:
            "Recurring all-day calendar sales require an original occurrence date.",
          eventReference: input.metadata.eventReference,
          cause,
        })
    )
  );
};

const toCalendarSale = (input: {
  readonly calendarId: SalesCalendarId;
  readonly discountId: StoredDiscountId;
  readonly metadata: Schema.Schema.Type<typeof calendarSaleEventMetadataSchema>;
  readonly occurrence: {
    readonly occurrenceDate: string;
    readonly occurrenceReference: CalendarSaleOccurrenceReference;
  };
}): CalendarSale => {
  const startsAt = toWorkspaceStartOfDay(input.metadata.startDate);
  const endDate = Temporal.PlainDate.from(input.metadata.endDate);
  const expiresAt = toWorkspaceStartOfDay(endDate);

  return {
    calendarId: input.calendarId,
    eventReference: input.metadata.eventReference,
    occurrenceReference: input.occurrence.occurrenceReference,
    occurrenceDate: input.occurrence.occurrenceDate,
    discountId: input.discountId,
    startsAt: temporalInstantToIsoString(startsAt),
    expiresAt: temporalInstantToIsoString(expiresAt),
    countdownStartsAt: temporalInstantToIsoString(
      expiresAt.subtract({ hours: 24 })
    ),
    lastDay: endDate.subtract({ days: 1 }).toString(),
  };
};

const toWorkspaceStartOfDay = (date: Temporal.PlainDate | string) =>
  Temporal.PlainDate.from(date)
    .toZonedDateTime({ timeZone: workspaceSiteConstants.location.timeZone })
    .toInstant();

const isBookingDateCovered = (input: {
  readonly metadata: Schema.Schema.Type<typeof calendarSaleEventMetadataSchema>;
  readonly bookingDate: string;
}) =>
  input.metadata.startDate <= input.bookingDate &&
  input.bookingDate < input.metadata.endDate;

const decodeCalendarEventReference = Schema.decodeUnknownSync(
  calendarEventReferenceSchema
);

const decodeCalendarSaleOccurrenceReference = Schema.decodeUnknownSync(
  calendarSaleOccurrenceReferenceSchema
);

const getErrorEventReference = (event: GoogleCalendarEvent) => {
  const value = event.id ?? event.iCalUID;

  return value && Schema.is(calendarEventReferenceSchema)(value)
    ? { eventReference: decodeCalendarEventReference(value) }
    : {};
};
