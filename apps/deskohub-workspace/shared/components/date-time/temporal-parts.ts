import { Option, Predicate, Schema } from "effect";
import {
  localDateTimeSchema,
  localTimeSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";

export type TemporalBoundInput = string | (() => string);

export type TemporalTimeBoundInput = string | (() => string | undefined);

const decodeLocalDateTime = Schema.decodeUnknownOption(localDateTimeSchema);
const decodePlainDate = Schema.decodeUnknownOption(plainDateStringSchema);
const decodeLocalTime = Schema.decodeUnknownOption(localTimeSchema);

/**
 * Decodes a canonical `YYYY-MM-DD` boundary value. Datetime-shaped or
 * malformed strings decode to `undefined` instead of a silently re-shaped
 * date, matching what the native date field would submit.
 */
export const parsePlainDate = (value: string | undefined) =>
  decodePlainDate(value).pipe(
    Option.map((date) => Temporal.PlainDate.from(date)),
    Option.getOrUndefined
  );

export const parseLocalTime = (value: string | undefined) =>
  decodeLocalTime(value).pipe(
    Option.map((time) => Temporal.PlainTime.from(time)),
    Option.getOrUndefined
  );

export const parsePlainDateTime = (value: string | undefined) =>
  decodeLocalDateTime(value).pipe(
    Option.map((dateTime) => Temporal.PlainDateTime.from(dateTime)),
    Option.getOrUndefined
  );

export const resolveBound = (
  bound: TemporalTimeBoundInput | undefined
): string | undefined => {
  if (bound === undefined) return undefined;
  return Predicate.isFunction(bound) ? bound() : bound;
};

export const resolveTimeBound = (
  bound: TemporalTimeBoundInput | undefined
): string | undefined => {
  if (bound === undefined) return undefined;
  return Predicate.isFunction(bound) ? bound() : bound;
};

export const resolvePlainDateBound = (
  bound: TemporalTimeBoundInput | undefined
) => parsePlainDate(resolveBound(bound));

export const resolvePlainDateTimeBound = (
  bound: TemporalTimeBoundInput | undefined
) => parsePlainDateTime(resolveBound(bound));

export const formatMinuteDateTime = (dateTime: Temporal.PlainDateTime) =>
  dateTime.toString({ smallestUnit: "minute" });

export const getSameDayTimeBound = ({
  date,
  dateTimeBound,
}: {
  readonly date: Temporal.PlainDate | undefined;
  readonly dateTimeBound: Temporal.PlainDateTime | undefined;
}): string | undefined =>
  (date &&
  dateTimeBound &&
  Temporal.PlainDate.compare(date, dateTimeBound.toPlainDate()) === 0
    ? dateTimeBound.toPlainTime().toString({ smallestUnit: "minute" })
    : undefined) || undefined;

export const getCalendarDate = (date: Temporal.PlainDate) =>
  new Date(date.year, date.month - 1, date.day, 12);

export const getPlainDateFromCalendarDate = (date: Date) =>
  Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });

export const isPlainDateDisabled = ({
  date,
  isDateDisabled,
  maximumDate,
  minimumDate,
}: {
  readonly date: Temporal.PlainDate;
  readonly isDateDisabled?: ((date: Temporal.PlainDate) => boolean) | undefined;
  readonly maximumDate: Temporal.PlainDate | undefined;
  readonly minimumDate: Temporal.PlainDate | undefined;
}) =>
  Boolean(
    (minimumDate && Temporal.PlainDate.compare(date, minimumDate) < 0) ||
      (maximumDate && Temporal.PlainDate.compare(date, maximumDate) > 0) ||
      isDateDisabled?.(date)
  );
