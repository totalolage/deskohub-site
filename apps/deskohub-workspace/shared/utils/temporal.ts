import { Schema } from "effect";

export const TemporalInstantSchema = Schema.declare(
  (input: unknown): input is ReturnType<typeof Temporal.Instant.from> =>
    input instanceof Temporal.Instant,
  {
    identifier: "TemporalInstant",
    description: "Temporal instant value.",
  }
);

export const TemporalPlainDateSchema = Schema.declare(
  (input: unknown): input is ReturnType<typeof Temporal.PlainDate.from> =>
    input instanceof Temporal.PlainDate,
  {
    identifier: "TemporalPlainDate",
    description: "Temporal plain date value.",
  }
);

export const TemporalPlainTimeSchema = Schema.declare(
  (input: unknown): input is ReturnType<typeof Temporal.PlainTime.from> =>
    input instanceof Temporal.PlainTime,
  {
    identifier: "TemporalPlainTime",
    description: "Temporal plain time value.",
  }
);

export type TemporalInstant = typeof TemporalInstantSchema.Type;
export type TemporalPlainDate = typeof TemporalPlainDateSchema.Type;
export type TemporalPlainTime = typeof TemporalPlainTimeSchema.Type;

export const localTimeEffectSchema = Schema.String.check(
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

export type LocalTime = typeof localTimeEffectSchema.Type;

export const localDateTimeEffectSchema = Schema.String.check(
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

export type LocalDateTime = typeof localDateTimeEffectSchema.Type;

export const instantStringEffectSchema = Schema.String.check(
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

export type Instant = typeof instantStringEffectSchema.Type;

export const isPlainDateString = (annotations?: Schema.Annotations.Filter) =>
  Schema.makeFilter<string>((value) => {
    try {
      return Temporal.PlainDate.from(value).toString() === value;
    } catch {
      return false;
    }
  }, annotations);

export const plainDateStringEffectSchema = Schema.String.check(
  isPlainDateString()
)
  .pipe(Schema.brand("PlainDate"))
  .annotate({
    identifier: "PlainDate",
    description: "Canonical calendar date in YYYY-MM-DD format.",
  });

export type PlainDate = typeof plainDateStringEffectSchema.Type;

export const isValidDate = (date: Date) => !Number.isNaN(date.getTime());

export const temporalInstantToDate = (instant: TemporalInstant) =>
  new Date(instant.epochMilliseconds);

export const temporalInstantToIsoString = (instant: TemporalInstant) =>
  temporalInstantToDate(instant).toISOString();

export const dateToTemporalInstant = (date: Date) =>
  isValidDate(date)
    ? Temporal.Instant.fromEpochMilliseconds(date.getTime())
    : undefined;

export const toTemporalInstant = (date: Date | TemporalInstant) =>
  date instanceof Date ? dateToTemporalInstant(date) : date;

export const temporalPlainDateToDate = ({
  date,
  plainTime,
  timeZone,
}: {
  readonly date: TemporalPlainDate;
  readonly plainTime: TemporalPlainTime;
  readonly timeZone: string;
}) =>
  temporalInstantToDate(
    date.toZonedDateTime({ plainTime, timeZone }).toInstant()
  );

export const temporalInstantToPlainDate = ({
  instant,
  timeZone,
}: {
  readonly instant: TemporalInstant;
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
  readonly dateTime: ReturnType<typeof Temporal.PlainDateTime.from>;
  readonly timeZone: string;
  readonly now?: TemporalInstant;
}) =>
  Temporal.PlainDateTime.compare(
    dateTime,
    now.toZonedDateTimeISO(timeZone).toPlainDateTime()
  ) > 0;

export const makeWholeHourInstantStringEffectSchema = (timeZone: string) =>
  instantStringEffectSchema.check(
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
