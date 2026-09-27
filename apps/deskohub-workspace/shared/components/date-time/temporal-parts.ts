import { Option, Predicate, Schema } from "effect";
import { localDateTimeSchema } from "@/shared/utils/temporal";

export type TemporalBoundInput = string | (() => string);

const decodeLocalDateTime = Schema.decodeUnknownOption(localDateTimeSchema);

export const parsePlainDate = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    return undefined;
  }
};

export const parsePlainDateTime = (value: string | undefined) =>
  decodeLocalDateTime(value).pipe(
    Option.map((dateTime) => Temporal.PlainDateTime.from(dateTime)),
    Option.getOrUndefined
  );

export const resolveBound = (
  bound: TemporalBoundInput | undefined
): string | undefined => {
  if (bound === undefined) return undefined;
  return Predicate.isFunction(bound) ? bound() : bound;
};

export const resolvePlainDateBound = (bound: TemporalBoundInput | undefined) =>
  parsePlainDate(resolveBound(bound));

export const resolvePlainDateTimeBound = (
  bound: TemporalBoundInput | undefined
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
  date &&
  dateTimeBound &&
  Temporal.PlainDate.compare(date, dateTimeBound.toPlainDate()) === 0
    ? dateTimeBound.toPlainTime().toString({ smallestUnit: "minute" })
    : undefined;

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
