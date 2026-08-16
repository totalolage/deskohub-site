import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";

export const nexiOperationChannels = [
  "ECOMMERCE",
  "BACKOFFICE",
  "POS",
] as const;

export const nexiOperationTypes = [
  "AUTHORIZATION",
  "CAPTURE",
  "REFUND",
  "CANCEL",
  "VOID",
] as const;

const getPaymentDateTimeBounds = (
  from: string | undefined,
  to: string | undefined,
  current: Temporal.PlainDate,
  maximumMonths?: number
) => {
  const fromDate = (() => {
    try {
      return from
        ? Temporal.PlainDate.from(from)
        : current.subtract({ days: 7 });
    } catch {
      return current.subtract({ days: 7 });
    }
  })();
  const toDate = (() => {
    try {
      return to ? Temporal.PlainDate.from(to) : current;
    } catch {
      return current;
    }
  })();
  const [startDate, endDate] =
    Temporal.PlainDate.compare(fromDate, toDate) <= 0
      ? [fromDate, toDate]
      : [toDate, fromDate];
  const maximumEndDate = maximumMonths
    ? startDate.add({ months: maximumMonths }).subtract({ days: 1 })
    : null;
  const boundedEndDate =
    !maximumEndDate || Temporal.PlainDate.compare(endDate, maximumEndDate) <= 0
      ? endDate
      : maximumEndDate;
  const atStartOfDay = (date: Temporal.PlainDate) =>
    date
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("00:00"),
        timeZone: "Europe/Prague",
      })
      .toInstant()
      .toString();
  return {
    from: startDate.toString(),
    fromTime: atStartOfDay(startDate),
    to: boundedEndDate.toString(),
    toTime: atStartOfDay(boundedEndDate.add({ days: 1 })),
  };
};

export const getAdministrationPaymentDateTimeBounds = (
  from: string | undefined,
  to: string | undefined,
  current = getCurrentWorkspaceDate()
) => getPaymentDateTimeBounds(from, to, current);

export const getAdministrationNexiOrderDateTimeBounds = (
  from: string | undefined,
  to: string | undefined,
  current = getCurrentWorkspaceDate()
) => getPaymentDateTimeBounds(from, to, current, 1);

const parseProviderFilter = <Value extends string>(
  value: string | undefined,
  allowedValues: readonly Value[]
): Value | undefined => {
  const normalized = value?.trim().toUpperCase();
  return allowedValues.find((allowed) => allowed === normalized);
};

export const getAdministrationNexiOperationFilters = (input: {
  readonly channel?: string;
  readonly operationType?: string;
}) => ({
  channel: parseProviderFilter(input.channel, nexiOperationChannels),
  operationType: parseProviderFilter(input.operationType, nexiOperationTypes),
});
