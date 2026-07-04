import "@/shared/polyfills/temporal";

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

export const isValidDate = (date: Date) => !Number.isNaN(date.getTime());

export const temporalInstantToDate = (instant: TemporalInstant) =>
  new Date(instant.epochMilliseconds);

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
