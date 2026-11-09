import { Option } from "effect";
import { type PlainDate, parsePlainDate } from "@/shared/utils/temporal";

/**
 * Reservation start dates a discount code covers. Both dates are inclusive
 * Prague calendar dates. A code without a window covers every date.
 */
export type ServiceDateWindow = {
  readonly serviceDateFrom: PlainDate | null;
  readonly serviceDateUntil: PlainDate | null;
};

/** The window of a code that covers every reservation date. */
export const unrestrictedServiceDates: ServiceDateWindow = {
  serviceDateFrom: null,
  serviceDateUntil: null,
};

/**
 * Why a service-date window can't be stored or applied, or `undefined` when
 * it can: both dates are set or both are absent, and the last date isn't
 * before the first.
 */
export const getServiceDateWindowIssue = ({
  serviceDateFrom,
  serviceDateUntil,
}: ServiceDateWindow): string | undefined => {
  if (serviceDateFrom === null || serviceDateUntil === null) {
    return serviceDateFrom === serviceDateUntil
      ? undefined
      : "serviceDateFrom and serviceDateUntil must both be set or both be empty";
  }

  return comparePlainDates(serviceDateUntil, serviceDateFrom).pipe(
    Option.match({
      onNone: () => "service dates must be canonical calendar dates",
      onSome: (order) =>
        order < 0
          ? "serviceDateUntil must not be before serviceDateFrom"
          : undefined,
    })
  );
};

/**
 * Whether a reservation that starts on `firstServiceDate` (its Prague start
 * date) may use a code with this window. A window with only one date, an
 * inverted window, or a non-canonical date fails closed.
 */
export const isFirstServiceDateEligible = (
  window: ServiceDateWindow,
  firstServiceDate: string
): boolean => {
  if (getServiceDateWindowIssue(window) !== undefined) return false;
  const { serviceDateFrom, serviceDateUntil } = window;
  if (serviceDateFrom === null || serviceDateUntil === null) return true;

  return Option.all([
    comparePlainDates(firstServiceDate, serviceDateFrom),
    comparePlainDates(firstServiceDate, serviceDateUntil),
  ]).pipe(
    Option.exists(
      ([afterFirst, beforeLast]) => afterFirst >= 0 && beforeLast <= 0
    )
  );
};

const parseCanonicalPlainDate = (value: string) =>
  parsePlainDate(value).pipe(
    Option.filter((date) => date.toString() === value)
  );

const comparePlainDates = (left: string, right: string) =>
  Option.all([
    parseCanonicalPlainDate(left),
    parseCanonicalPlainDate(right),
  ]).pipe(Option.map(([a, b]) => Temporal.PlainDate.compare(a, b)));
