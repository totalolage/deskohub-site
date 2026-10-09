import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";

export type AdministrationReservationDateRange = {
  readonly from?: string;
  readonly to?: string;
};

export type AdministrationReservationClosedDateRange =
  Required<AdministrationReservationDateRange>;

export type AdministrationReservationDateRangeField = "date" | "from" | "to";

export type AdministrationReservationDateRangeFailure = {
  readonly field: AdministrationReservationDateRangeField;
  readonly value: string;
};

export type AdministrationReservationDateRangeStrictResult =
  | {
      readonly ok: true;
      readonly range: AdministrationReservationDateRange | undefined;
    }
  | {
      readonly ok: false;
      readonly failures: readonly AdministrationReservationDateRangeFailure[];
    };

export const getAdministrationReservationDateRange = ({
  date,
  from,
  to,
}: {
  readonly date?: string;
  readonly from?: string;
  readonly to?: string;
}): AdministrationReservationDateRange | undefined => {
  const legacyDate = parseCalendarDate(date);
  const fromDate = parseCalendarDate(from);
  const toDate = parseCalendarDate(to);
  return resolveReservationDateRange({
    date: legacyDate,
    from: fromDate,
    to: toDate,
  });
};

/**
 * Like the lenient page parser, but fails closed with the raw values that do
 * not parse as calendar dates instead of silently dropping the narrowing
 * filter.
 */
export const getAdministrationReservationDateRangeStrict = ({
  date,
  from,
  to,
}: {
  readonly date?: string;
  readonly from?: string;
  readonly to?: string;
}): AdministrationReservationDateRangeStrictResult => {
  const failures: AdministrationReservationDateRangeFailure[] = [];
  const parseStrict = (
    field: AdministrationReservationDateRangeField,
    value: string | undefined
  ) => {
    if (!value) return undefined;
    try {
      return Temporal.PlainDate.from(value);
    } catch {
      failures.push({ field, value });
      return undefined;
    }
  };
  const legacyDate = parseStrict("date", date);
  const fromDate = parseStrict("from", from);
  const toDate = parseStrict("to", to);
  if (failures.length > 0) return { ok: false, failures };
  return {
    ok: true,
    range: resolveReservationDateRange({
      date: legacyDate,
      from: fromDate,
      to: toDate,
    }),
  };
};

const resolveReservationDateRange = ({
  date,
  from,
  to,
}: {
  readonly date: Temporal.PlainDate | undefined;
  readonly from: Temporal.PlainDate | undefined;
  readonly to: Temporal.PlainDate | undefined;
}): AdministrationReservationDateRange | undefined => {
  if (!from && !to) {
    return date ? { from: date.toString(), to: date.toString() } : undefined;
  }

  if (from && to) {
    return Temporal.PlainDate.compare(from, to) <= 0
      ? { from: from.toString(), to: to.toString() }
      : { from: to.toString(), to: from.toString() };
  }

  return from ? { from: from.toString() } : { to: to?.toString() };
};

export const getAdministrationOverviewDateRanges = (
  currentDate = getCurrentWorkspaceDate()
): {
  readonly today: AdministrationReservationClosedDateRange;
  readonly upcoming: AdministrationReservationClosedDateRange;
  readonly lastSevenDays: AdministrationReservationClosedDateRange;
} => ({
  today: {
    from: currentDate.toString(),
    to: currentDate.toString(),
  },
  upcoming: {
    from: currentDate.add({ days: 1 }).toString(),
    to: currentDate.add({ days: 30 }).toString(),
  },
  lastSevenDays: {
    from: currentDate.subtract({ days: 6 }).toString(),
    to: currentDate.toString(),
  },
});

export const getAdministrationReservationDateShortcuts = (
  currentDate = getCurrentWorkspaceDate()
): {
  readonly today: AdministrationReservationClosedDateRange;
  readonly upcoming: AdministrationReservationDateRange;
  readonly past: AdministrationReservationDateRange;
} => ({
  today: {
    from: currentDate.toString(),
    to: currentDate.toString(),
  },
  upcoming: {
    from: currentDate.add({ days: 1 }).toString(),
  },
  past: {
    to: currentDate.subtract({ days: 1 }).toString(),
  },
});

const parseCalendarDate = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    return undefined;
  }
};
