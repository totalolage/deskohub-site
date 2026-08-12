import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";

export type AdministrationReservationDateRange = {
  readonly from?: string;
  readonly to?: string;
};

export type AdministrationReservationClosedDateRange =
  Required<AdministrationReservationDateRange>;

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
  if (!fromDate && !toDate) {
    return legacyDate
      ? { from: legacyDate.toString(), to: legacyDate.toString() }
      : undefined;
  }

  if (fromDate && toDate) {
    return Temporal.PlainDate.compare(fromDate, toDate) <= 0
      ? { from: fromDate.toString(), to: toDate.toString() }
      : { from: toDate.toString(), to: fromDate.toString() };
  }

  return fromDate ? { from: fromDate.toString() } : { to: toDate?.toString() };
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

const parseCalendarDate = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    return undefined;
  }
};
