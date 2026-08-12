import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";

export type AdministrationReservationDateRange = {
  readonly from: string;
  readonly to: string;
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
  const startDate = fromDate ?? toDate ?? legacyDate;
  const endDate = toDate ?? fromDate ?? legacyDate;
  if (!startDate || !endDate) return undefined;

  return Temporal.PlainDate.compare(startDate, endDate) <= 0
    ? { from: startDate.toString(), to: endDate.toString() }
    : { from: endDate.toString(), to: startDate.toString() };
};

export const getAdministrationOverviewDateRanges = (
  currentDate = getCurrentWorkspaceDate()
) => ({
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
