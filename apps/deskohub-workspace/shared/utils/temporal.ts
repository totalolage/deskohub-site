import { Schema } from "effect";

export const TemporalInstantSchema = Schema.declare(
  (input: unknown): input is Temporal.Instant =>
    input instanceof Temporal.Instant,
  {
    identifier: "TemporalInstant",
    description: "Temporal instant value.",
  }
);

export const TemporalPlainDateSchema = Schema.declare(
  (input: unknown): input is Temporal.PlainDate =>
    input instanceof Temporal.PlainDate,
  {
    identifier: "TemporalPlainDate",
    description: "Temporal plain date value.",
  }
);

export const TemporalPlainTimeSchema = Schema.declare(
  (input: unknown): input is Temporal.PlainTime =>
    input instanceof Temporal.PlainTime,
  {
    identifier: "TemporalPlainTime",
    description: "Temporal plain time value.",
  }
);

export const localTimeSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      return (
        Temporal.PlainTime.from(value).toString({ smallestUnit: "minute" }) ===
        value
      );
    } catch {
      return false;
    }
  })
)
  .pipe(Schema.brand("LocalTime"))
  .annotate({
    identifier: "LocalTime",
    description: "Canonical local time in HH:mm format.",
  });

export type LocalTime = typeof localTimeSchema.Type;

export const localDateTimeSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      const dateTime = Temporal.PlainDateTime.from(value);
      return (
        dateTime.toString({
          smallestUnit: dateTime.second === 0 ? "minute" : "second",
        }) === value
      );
    } catch {
      return false;
    }
  })
)
  .pipe(Schema.brand("LocalDateTime"))
  .annotate({
    identifier: "LocalDateTime",
    description: "Canonical local date-time without an offset.",
  });

export type LocalDateTime = typeof localDateTimeSchema.Type;

export const instantStringSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      Temporal.Instant.from(value);
      return true;
    } catch {
      return false;
    }
  })
)
  .pipe(Schema.brand("Instant"))
  .annotate({
    identifier: "Instant",
    description: "ISO instant string with an offset.",
  });

export type Instant = typeof instantStringSchema.Type;

export const isPlainDateString = (annotations?: Schema.Annotations.Filter) =>
  Schema.makeFilter<string>((value) => {
    try {
      return Temporal.PlainDate.from(value).toString() === value;
    } catch {
      return false;
    }
  }, annotations);

export const plainDateStringSchema = Schema.String.check(isPlainDateString())
  .pipe(Schema.brand("PlainDate"))
  .annotate({
    identifier: "PlainDate",
    description: "Canonical calendar date in YYYY-MM-DD format.",
  });

export type PlainDate = typeof plainDateStringSchema.Type;

export const isValidDate = (date: Date) => !Number.isNaN(date.getTime());

export const temporalInstantToDate = (instant: Temporal.Instant) =>
  new Date(instant.epochMilliseconds);

export const temporalInstantToIsoString = (instant: Temporal.Instant) =>
  temporalInstantToDate(instant).toISOString();

export const dateToTemporalInstant = (date: Date) =>
  isValidDate(date)
    ? Temporal.Instant.fromEpochMilliseconds(date.getTime())
    : undefined;

export const toTemporalInstant = (date: Date | Temporal.Instant) =>
  date instanceof Date ? dateToTemporalInstant(date) : date;

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

export const dateToTemporalPlainDate = ({
  date,
  timeZone,
}: {
  readonly date: Date;
  readonly timeZone: string;
}) => dateToTemporalInstant(date)?.toZonedDateTimeISO(timeZone).toPlainDate();

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

export const makeWholeHourInstantStringSchema = (timeZone: string) =>
  instantStringSchema.check(
    Schema.makeFilter((value) => {
      try {
        const time = Temporal.Instant.from(value)
          .toZonedDateTimeISO(timeZone)
          .toPlainTime();

        return (
          time.minute === 0 &&
          time.second === 0 &&
          time.millisecond === 0 &&
          time.microsecond === 0 &&
          time.nanosecond === 0
        );
      } catch {
        return false;
      }
    })
  );
