import { Option } from "effect";
import type { DateChoice } from "../selection/booking-selection";
import {
  monthOf,
  monthWeeks,
  type PragueDate,
  type PragueMonth,
} from "../selection/prague-date";

/**
 * How a day of the calendar shows. A day the customer can't pick is
 * `outside-range` before the earliest or after the latest bookable date and
 * `unavailable` inside it; either wins over `selected`, so a selection the
 * calendar no longer offers isn't shown as a valid pick.
 */
export type CalendarDayState =
  | "selected"
  | "available"
  | "unavailable"
  | "outside-range";

export interface CalendarDay {
  readonly date: PragueDate;
  /** The day of the month, 1..31. */
  readonly day: number;
  readonly state: CalendarDayState;
}

export interface MonthCalendarModel {
  /** The month shown, kept within the months the dates span. */
  readonly month: PragueMonth;
  /** Monday-first weeks of seven cells; days of other months are empty. */
  readonly weeks: ReadonlyArray<ReadonlyArray<Option.Option<CalendarDay>>>;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
}

const monthIndex = ({ year, month }: PragueMonth) => year * 12 + month - 1;

/** `month` moved into the months from `earliest`'s to `latest`'s. */
const withinDates = (month: PragueMonth, dates: DateChoice): PragueMonth => {
  const first = monthOf(dates.earliest);
  const last = monthOf(dates.latest);
  if (monthIndex(month) < monthIndex(first)) return first;
  if (monthIndex(month) > monthIndex(last)) return last;
  return month;
};

const dayState = (
  date: PragueDate,
  dates: DateChoice,
  selected: PragueDate | undefined
): CalendarDayState => {
  if (date < dates.earliest || date > dates.latest) return "outside-range";
  if (dates.unavailable.has(date)) return "unavailable";
  return date === selected ? "selected" : "available";
};

/** The month a calendar opens on: the selected date's, else the earliest's. */
export const initialCalendarMonth = (
  dates: DateChoice,
  selected: PragueDate | undefined
): PragueMonth => withinDates(monthOf(selected ?? dates.earliest), dates);

/** The days of `month` and whether the calendar can page away from it. */
export const monthCalendarModel = ({
  month: requested,
  dates,
  selected,
}: {
  readonly month: PragueMonth;
  readonly dates: DateChoice;
  readonly selected: PragueDate | undefined;
}): MonthCalendarModel => {
  const month = withinDates(requested, dates);
  return {
    month,
    weeks: monthWeeks(month).map((week) =>
      week.map(
        Option.map(
          (date): CalendarDay => ({
            date,
            day: Number(date.slice(8)),
            state: dayState(date, dates, selected),
          })
        )
      )
    ),
    canGoPrevious: monthIndex(month) > monthIndex(monthOf(dates.earliest)),
    canGoNext: monthIndex(month) < monthIndex(monthOf(dates.latest)),
  };
};
