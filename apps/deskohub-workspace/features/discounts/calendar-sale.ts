import type { GoogleCalendarEvent } from "@deskohub/google-calendar";
import { Data, Effect, Option, Schema } from "effect";
import { parse } from "smol-toml";
import {
  type DiscountProductIdentity,
  discountProductIdentityEffectSchema,
} from "./contracts";

const saleMarker = "[deskohub:sale]";
const workspaceTimeZone = "Europe/Prague";

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

const calendarDateSchema = Schema.String.check(
  Schema.makeFilter<string>(
    (input) => {
      try {
        return Temporal.PlainDate.from(input).toString() === input;
      } catch {
        return false;
      }
    },
    { expected: "a valid ISO calendar date in YYYY-MM-DD format" }
  )
)
  .pipe(Schema.brand("CalendarDate"))
  .annotate({
    identifier: "CalendarDate",
    description: "Valid ISO calendar date in YYYY-MM-DD format.",
  });

const calendarSaleEventMetadataSchema = Schema.Struct({
  eventReference: calendarEventReferenceSchema,
  label: Schema.NonEmptyString,
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
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

const calendarSaleConfigurationSchema = Schema.Struct({
  adjustment: Schema.Struct({
    kind: Schema.Literal("percentage"),
    basisPoints: Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: 10_000 })
    ),
  }),
  products: Schema.NonEmptyArray(discountProductIdentityEffectSchema).check(
    Schema.isUnique()
  ),
});

type CalendarEventReference = Schema.Schema.Type<
  typeof calendarEventReferenceSchema
>;

type CalendarSaleOccurrenceReference = Schema.Schema.Type<
  typeof calendarSaleOccurrenceReferenceSchema
>;

type CalendarSaleConfigurationFailureReason =
  | "invalid_event"
  | "invalid_occurrence_reference"
  | "invalid_toml"
  | "invalid_sale_configuration";

export class CalendarSaleConfigurationError extends Data.TaggedError(
  "CalendarSaleConfigurationError"
)<{
  readonly reason: CalendarSaleConfigurationFailureReason;
  readonly message: string;
  readonly eventReference?: CalendarEventReference;
  readonly cause?: unknown;
}> {}

export type CalendarSale = {
  readonly calendarId: string;
  readonly eventReference: CalendarEventReference;
  readonly occurrenceReference: CalendarSaleOccurrenceReference;
  readonly occurrenceDate: string;
  readonly label: string;
  readonly basisPoints: number;
  readonly products: readonly DiscountProductIdentity[];
  readonly expiresAt: string;
  readonly countdownStartsAt: string;
};

export const normalizeCalendarSales = Effect.fn("CalendarSale.normalizeAll")(
  (input: {
    readonly calendarId: string;
    readonly events: readonly GoogleCalendarEvent[];
    readonly reservationDate: string;
  }) =>
    Effect.succeed(input).pipe(
      Effect.bind("sales", ({ events, ...context }) =>
        Effect.forEach(events, (event) =>
          normalizeCalendarSale({ ...context, event })
        )
      ),
      Effect.map(({ sales }) => sales.flatMap((sale) => Option.toArray(sale)))
    )
);

const normalizeCalendarSale = (input: {
  readonly calendarId: string;
  readonly event: GoogleCalendarEvent;
  readonly reservationDate: string;
}): Effect.Effect<
  Option.Option<CalendarSale>,
  CalendarSaleConfigurationError
> => {
  if (input.event.status === "cancelled" || !hasSaleMarker(input.event)) {
    return Effect.succeed(Option.none());
  }

  return Effect.succeed(input).pipe(
    Effect.bind("metadata", decodeCalendarSaleEventMetadata),
    Effect.bind("configuration", decodeCalendarSaleConfiguration),
    Effect.bind("occurrence", getCalendarSaleOccurrence),
    Effect.let("sale", toCalendarSale),
    Effect.map(({ metadata, reservationDate, sale }) =>
      isReservationDateCovered({ metadata, reservationDate })
        ? Option.some(sale)
        : Option.none()
    )
  );
};

const decodeCalendarSaleEventMetadata = (input: {
  readonly event: GoogleCalendarEvent;
}) =>
  Schema.decodeUnknownEffect(calendarSaleEventMetadataSchema, {
    errors: "all",
  })({
    eventReference: input.event.id ?? input.event.iCalUID ?? "",
    label: input.event.summary?.trim() ?? "",
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

const decodeCalendarSaleConfiguration = (input: {
  readonly event: GoogleCalendarEvent;
  readonly metadata: {
    readonly eventReference: CalendarEventReference;
  };
}) =>
  Effect.succeed(input).pipe(
    Effect.bind("toml", parseCalendarSaleToml),
    Effect.bind("configuration", ({ toml }) =>
      Schema.decodeUnknownEffect(calendarSaleConfigurationSchema, {
        errors: "all",
        onExcessProperty: "error",
      })(toml).pipe(
        Effect.mapError(
          (cause) =>
            new CalendarSaleConfigurationError({
              reason: "invalid_sale_configuration",
              message:
                "Calendar sale TOML does not match the required adjustment and product schema.",
              eventReference: input.metadata.eventReference,
              cause,
            })
        )
      )
    ),
    Effect.map(({ configuration }) => configuration)
  );

const parseCalendarSaleToml = (input: {
  readonly event: GoogleCalendarEvent;
  readonly metadata: {
    readonly eventReference: CalendarEventReference;
  };
}) =>
  Effect.try({
    try: () => parse(getSaleToml(input.event)),
    catch: (cause) =>
      new CalendarSaleConfigurationError({
        reason: "invalid_toml",
        message: "Calendar sale description contains invalid TOML.",
        eventReference: input.metadata.eventReference,
        cause,
      }),
  });

const getCalendarSaleOccurrence = (input: {
  readonly calendarId: string;
  readonly event: GoogleCalendarEvent;
  readonly metadata: {
    readonly eventReference: CalendarEventReference;
    readonly startDate: Schema.Schema.Type<typeof calendarDateSchema>;
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

  return Schema.decodeUnknownEffect(calendarDateSchema)(
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
  readonly calendarId: string;
  readonly configuration: Schema.Schema.Type<
    typeof calendarSaleConfigurationSchema
  >;
  readonly metadata: Schema.Schema.Type<typeof calendarSaleEventMetadataSchema>;
  readonly occurrence: {
    readonly occurrenceDate: string;
    readonly occurrenceReference: CalendarSaleOccurrenceReference;
  };
}): CalendarSale => {
  const expiresAt = Temporal.PlainDate.from(input.metadata.endDate)
    .toZonedDateTime({ timeZone: workspaceTimeZone })
    .toInstant();

  return {
    calendarId: input.calendarId,
    eventReference: input.metadata.eventReference,
    occurrenceReference: input.occurrence.occurrenceReference,
    occurrenceDate: input.occurrence.occurrenceDate,
    label: input.metadata.label,
    basisPoints: input.configuration.adjustment.basisPoints,
    products: input.configuration.products,
    expiresAt: toIsoInstant(expiresAt),
    countdownStartsAt: toIsoInstant(expiresAt.subtract({ hours: 24 })),
  };
};

const hasSaleMarker = (event: GoogleCalendarEvent) =>
  event.description?.trim().split(/\r?\n/, 1)[0] === saleMarker;

const getSaleToml = (event: GoogleCalendarEvent) =>
  event.description?.trim().split(/\r?\n/).slice(1).join("\n").trim() ?? "";

const isReservationDateCovered = (input: {
  readonly metadata: Schema.Schema.Type<typeof calendarSaleEventMetadataSchema>;
  readonly reservationDate: string;
}) =>
  input.metadata.startDate <= input.reservationDate &&
  input.reservationDate < input.metadata.endDate;

const decodeCalendarEventReference = Schema.decodeUnknownSync(
  calendarEventReferenceSchema
);

const decodeCalendarSaleOccurrenceReference = Schema.decodeUnknownSync(
  calendarSaleOccurrenceReferenceSchema
);

const getErrorEventReference = (event: GoogleCalendarEvent) => {
  const value = event.id ?? event.iCalUID;

  if (!value) {
    return {};
  }

  try {
    return { eventReference: decodeCalendarEventReference(value) };
  } catch {
    return {};
  }
};

const toIsoInstant = (instant: InstanceType<typeof Temporal.Instant>) =>
  new Date(Number(instant.epochMilliseconds)).toISOString();
