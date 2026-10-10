import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import type { AdministrationReservationStatusFilter } from "./administration.service";

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

/**
 * Resolves the start-date range an operator's reservation list shows. Without
 * an explicit range the list starts on January 1 of the current Workspace year
 * and stays open-ended, so upcoming bookings remain visible while date sorting
 * never pages through the complete provider history. A single customer's list
 * keeps that customer's complete history, and the refund queue keeps every
 * refund still owed.
 */
export const getAdministrationReservationListDateRange = (
  {
    customerId,
    status,
    ...filters
  }: Parameters<typeof getAdministrationReservationDateRange>[0] & {
    readonly customerId?: string;
    readonly status?: AdministrationReservationStatusFilter;
  },
  currentDate = getCurrentWorkspaceDate()
): AdministrationReservationDateRange | undefined =>
  getAdministrationReservationDateRange(filters) ??
  (customerId || status === "needs_refund"
    ? undefined
    : getAdministrationReservationListDefaultDateRange(currentDate));

export const getAdministrationReservationListDefaultDateRange = (
  currentDate = getCurrentWorkspaceDate()
): { readonly from: string } => ({
  from: currentDate.with({ month: 1, day: 1 }).toString(),
});

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
