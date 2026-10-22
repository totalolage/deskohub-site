import { Clock, Effect, Option, Schema, SchemaGetter } from "effect";

export const unixTimestampSecondsSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0)
).annotate({
  identifier: "UnixTimestampSeconds",
  description: "Whole seconds since the Unix epoch.",
});

export const TemporalInstantSchema = Schema.declare(
  (input): input is Temporal.Instant => input instanceof Temporal.Instant,
  {
    identifier: "TemporalInstant",
    description: "Temporal instant value.",
  }
);

/**
 * Current instant read from the Effect `Clock`, so tests can control time.
 */
export const currentInstant: Effect.Effect<Temporal.Instant> =
  Clock.currentTimeMillis.pipe(
    Effect.map((epochMilliseconds) =>
      Temporal.Instant.fromEpochMilliseconds(epochMilliseconds)
    )
  );

const parsePlainTime = Option.liftThrowable((value: string) =>
  Temporal.PlainTime.from(value)
);

const parsePlainDateTime = Option.liftThrowable((value: string) =>
  Temporal.PlainDateTime.from(value)
);

/** The instant an ISO string with an offset names, or none when it names no valid instant. */
export const parseInstant: (value: string) => Option.Option<Temporal.Instant> =
  Option.liftThrowable((value: string) => Temporal.Instant.from(value));

const parseZonedInstant = Option.liftThrowable(
  (value: string, timeZone: string) =>
    Temporal.Instant.from(value).toZonedDateTimeISO(timeZone)
);

/** The calendar date an ISO string names, or none when it names no valid date. */
export const parsePlainDate: (
  value: string
) => Option.Option<Temporal.PlainDate> = Option.liftThrowable((value: string) =>
  Temporal.PlainDate.from(value)
);

export const localTimeSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    Option.exists(
      parsePlainTime(value),
      (time) => time.toString({ smallestUnit: "minute" }) === value
    )
  )
)
  .pipe(Schema.brand("LocalTime"))
  .annotate({
    identifier: "LocalTime",
    description: "Canonical local time in HH:mm format.",
  });

export const localDateTimeSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    Option.exists(
      parsePlainDateTime(value),
      (dateTime) =>
        dateTime.toString({
          smallestUnit: dateTime.second === 0 ? "minute" : "second",
        }) === value
    )
  )
)
  .pipe(Schema.brand("LocalDateTime"))
  .annotate({
    identifier: "LocalDateTime",
    description: "Canonical local date-time without an offset.",
  });

export type LocalDateTime = typeof localDateTimeSchema.Type;

export const instantStringSchema = Schema.String.check(
  Schema.makeFilter((value) => Option.isSome(parseInstant(value)))
)
  .pipe(Schema.brand("Instant"))
  .annotate({
    identifier: "Instant",
    description: "ISO instant string with an offset.",
  });

export type Instant = typeof instantStringSchema.Type;

/**
 * A whole-millisecond instant stored as its ISO string, such as a work
 * unit subject's window bound or fire time; the ISO form round-trips it
 * exactly.
 */
export const instantFromIsoStringSchema = instantStringSchema.pipe(
  Schema.decodeTo(TemporalInstantSchema, {
    decode: SchemaGetter.transform((value) => Temporal.Instant.from(value)),
    encode: SchemaGetter.transform(
      (value) => temporalInstantToIsoString(value) as Instant
    ),
  })
);

export const isPlainDateString = (annotations?: Schema.Annotations.Filter) =>
  Schema.makeFilter<string>(
    (value) =>
      Option.exists(parsePlainDate(value), (date) => date.toString() === value),
    annotations
  );

export const plainDateStringSchema = Schema.String.check(isPlainDateString())
  .pipe(Schema.brand("PlainDate"))
  .annotate({
    identifier: "PlainDate",
    description: "Canonical calendar date in YYYY-MM-DD format.",
  });

export type PlainDate = typeof plainDateStringSchema.Type;

/** Every calendar date from `start` through `end`, inclusive. */
export const getPlainDatesBetween = (
  start: Temporal.PlainDate,
  end: Temporal.PlainDate
): Temporal.PlainDate[] => {
  const dates: Temporal.PlainDate[] = [];
  for (
    let cursor = start;
    Temporal.PlainDate.compare(cursor, end) <= 0;
    cursor = cursor.add({ days: 1 })
  ) {
    dates.push(cursor);
  }

  return dates;
};

export const temporalInstantToDate = (instant: Temporal.Instant) =>
  new Date(instant.epochMilliseconds);

export const temporalInstantToIsoString = (instant: Temporal.Instant) =>
  temporalInstantToDate(instant).toISOString();

export const temporalInstantToLocalDateTimeString = ({
  instant,
  timeZone,
}: {
  readonly instant: Temporal.Instant;
  readonly timeZone: string;
}) =>
  instant
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });

export const localDateTimeToOffsetInstantString = ({
  dateTime,
  timeZone,
}: {
  readonly dateTime: string;
  readonly timeZone: string;
}) =>
  Temporal.PlainDateTime.from(dateTime)
    .toZonedDateTime(timeZone)
    .toString({ smallestUnit: "second", timeZoneName: "never" });

/**
 * The instant a local date-time names in a time zone. Times skipped by a DST
 * gap resolve forward and repeated times resolve to the earlier occurrence.
 */
export const localDateTimeToInstant = ({
  dateTime,
  timeZone,
}: {
  readonly dateTime: string;
  readonly timeZone: string;
}) =>
  Temporal.PlainDateTime.from(dateTime).toZonedDateTime(timeZone).toInstant();

export const localDateTimeToTemporalInstantString = (input: {
  readonly dateTime: string;
  readonly timeZone: string;
}) => localDateTimeToInstant(input).toString();

export const temporalPlainDateToDate = ({
  date,
  plainTime,
  timeZone,
}: {
  readonly date: Temporal.PlainDate;
  readonly plainTime: Temporal.PlainTime;
  readonly timeZone: string;
}) =>
  temporalInstantToDate(
    date.toZonedDateTime({ plainTime, timeZone }).toInstant()
  );

export const temporalInstantToPlainDate = ({
  instant,
  timeZone,
}: {
  readonly instant: Temporal.Instant;
  readonly timeZone: string;
}) => instant.toZonedDateTimeISO(timeZone).toPlainDate();

export const isFuturePlainDateTime = ({
  dateTime,
  timeZone,
  now = Temporal.Now.instant(),
}: {
  readonly dateTime: Temporal.PlainDateTime;
  readonly timeZone: string;
  readonly now?: Temporal.Instant;
}) =>
  Temporal.PlainDateTime.compare(
    dateTime,
    now.toZonedDateTimeISO(timeZone).toPlainDateTime()
  ) > 0;

export const isMidnight = (
  value: Temporal.PlainDateTime | Temporal.ZonedDateTime
) =>
  value.hour === 0 &&
  value.minute === 0 &&
  value.second === 0 &&
  value.millisecond === 0 &&
  value.microsecond === 0 &&
  value.nanosecond === 0;

export const isWholeHour = (
  value: Temporal.PlainTime | Temporal.PlainDateTime | Temporal.ZonedDateTime
) =>
  value.minute === 0 &&
  value.second === 0 &&
  value.millisecond === 0 &&
  value.microsecond === 0 &&
  value.nanosecond === 0;

export const floorToWholeHour = (value: Temporal.ZonedDateTime) =>
  value.with({
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });

export const ceilToWholeHour = (value: Temporal.ZonedDateTime) =>
  isWholeHour(value) ? value : floorToWholeHour(value).add({ hours: 1 });

export const makeWholeHourInstantStringSchema = (timeZone: string) =>
  instantStringSchema.check(
    Schema.makeFilter((value) =>
      Option.exists(parseZonedInstant(value, timeZone), isWholeHour)
    )
  );

export const addCalendarDuration = ({
  instant,
  duration,
  timeZone,
}: {
  readonly instant: Temporal.Instant;
  readonly duration: Temporal.DurationLike;
  readonly timeZone: string;
}) => instant.toZonedDateTimeISO(timeZone).add(duration).toInstant();
