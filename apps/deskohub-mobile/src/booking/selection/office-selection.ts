import type {
  CustomerAvailability,
  CustomerBookingSelection,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Data, Option } from "effect";
import type { AvailabilityQuery, DateChoice } from "./booking-selection";
import {
  addDays,
  addMonths,
  daysBetween,
  hoursBetweenMidnights,
  type PragueDate,
  pragueToday,
} from "./prague-date";

/** An office booking the customer is putting together. */
export type OfficeDraft = {
  /** The first day. */
  readonly date: PragueDate;
  /** Days booked from `date`, inclusive. */
  readonly dayCount: number;
  readonly seats: number;
};

export type OfficeOffering = Extract<
  CustomerOffering,
  { readonly family: "office" }
>;

const horizonMonths = 1;

/** The draft an office screen opens with: one day today, one seat. */
export const defaultOfficeDraft = (today: PragueDate): OfficeDraft => ({
  date: today,
  dayCount: 1,
  seats: 1,
});

/** The last day the draft books. */
const lastDateOf = ({ date, dayCount }: OfficeDraft) =>
  addDays(date, dayCount - 1);

/** The booking the draft names, as the quote and checkout take it. */
export const toOfficeSelection = (
  draft: OfficeDraft
): CustomerBookingSelection => ({
  family: "office",
  date: draft.date,
  endDate: lastDateOf(draft),
  seats: draft.seats,
});

/** The calendar an office draft may pick from: today through one month. */
const officeDateRange = (today: PragueDate) => ({
  earliest: today,
  latest: addMonths(today, horizonMonths),
});

/** The availability query across the office booking horizon. */
export const officeAvailabilityQuery = (
  today: PragueDate
): AvailabilityQuery => {
  const { earliest, latest } = officeDateRange(today);
  return { kind: "office", from: earliest, to: latest };
};

/**
 * The most days a booking from `date` can span: up to `latest` and before
 * the first unavailable day, and no more than `maximumDurationHours` between
 * the Prague midnights it starts and ends on. Zero when `date` itself
 * can't be booked.
 */
export const maximumOfficeDayCount = (input: {
  readonly date: PragueDate;
  readonly latest: PragueDate;
  readonly unavailableDates: ReadonlyArray<string>;
  readonly maximumDurationHours: number;
}): number => {
  const firstUnavailable = input.unavailableDates
    .filter((date) => date >= input.date && date <= input.latest)
    .sort()[0];
  const lastAvailable =
    firstUnavailable === undefined
      ? input.latest
      : addDays(firstUnavailable, -1);
  let dayCount = Math.max(0, daysBetween(input.date, lastAvailable) + 1);
  // Each day is 23 to 25 hours, so this steps back at most a day or two.
  while (
    dayCount > 0 &&
    hoursBetweenMidnights(input.date, addDays(input.date, dayCount)) >
      input.maximumDurationHours
  ) {
    dayCount -= 1;
  }
  return dayCount;
};

/** Why an office draft can't continue to checkout. */
export type OfficeBlocker = Data.TaggedEnum<{
  /** The horizon's availability hasn't loaded. */
  AvailabilityPending: Record<never, never>;
  /** The first day is outside the horizon or taken. */
  DateUnavailable: Record<never, never>;
  /** The office is taken, or the stay too long, within the days drafted. */
  DayCountUnavailable: { readonly maximumDayCount: number };
  SeatsUnavailable: { readonly maximumSeats: number };
}>;
export const OfficeBlocker = Data.taggedEnum<OfficeBlocker>();

/** What an office screen offers and disables for its draft. */
export type OfficeEnablement = {
  readonly dates: DateChoice;
  /** The most days the drafted first day allows; zero when it allows none. */
  readonly maximumDayCount: number;
  /**
   * The most seats the office takes. One while the office capacity can't be
   * read; checkout checks the capacity again.
   */
  readonly maximumSeats: number;
  readonly notices: CustomerAvailability["notices"];
  readonly blockers: ReadonlyArray<OfficeBlocker>;
};

export const officeEnablement = (
  draft: OfficeDraft,
  context: {
    readonly now: Date;
    readonly offering: OfficeOffering;
    /** Availability settled for `officeAvailabilityQuery`. */
    readonly availability: Option.Option<CustomerAvailability>;
  }
): OfficeEnablement => {
  const { earliest, latest } = officeDateRange(pragueToday(context.now));
  const unavailableDates = Option.match(context.availability, {
    onNone: () => [],
    onSome: (availability) => availability.unavailableDates,
  });
  const inHorizon = draft.date >= earliest && draft.date <= latest;
  const maximumDayCount = inHorizon
    ? maximumOfficeDayCount({
        date: draft.date,
        latest,
        unavailableDates,
        maximumDurationHours: context.offering.maximumDurationHours,
      })
    : 0;
  const maximumSeats = context.offering.maximumSeats ?? 1;

  const blockers: Array<OfficeBlocker> = [];
  if (Option.isNone(context.availability)) {
    blockers.push(OfficeBlocker.AvailabilityPending());
  }
  if (maximumDayCount === 0) {
    blockers.push(OfficeBlocker.DateUnavailable());
  } else if (draft.dayCount < 1 || draft.dayCount > maximumDayCount) {
    blockers.push(OfficeBlocker.DayCountUnavailable({ maximumDayCount }));
  }
  if (draft.seats < 1 || draft.seats > maximumSeats) {
    blockers.push(OfficeBlocker.SeatsUnavailable({ maximumSeats }));
  }

  const lastDate = lastDateOf(draft);
  return {
    dates: { earliest, latest, unavailable: new Set(unavailableDates) },
    maximumDayCount,
    maximumSeats,
    notices: Option.match(context.availability, {
      onNone: () => [],
      onSome: (availability) =>
        availability.notices.filter(
          (notice) => notice.date >= draft.date && notice.date <= lastDate
        ),
    }),
    blockers,
  };
};

/**
 * The draft with its day count and seats brought within what the
 * enablement allows. A first day that allows no days keeps the draft's
 * count, and the screen shows the day unavailable.
 */
export const clampOfficeDraft = (
  draft: OfficeDraft,
  enablement: Pick<OfficeEnablement, "maximumDayCount" | "maximumSeats">
): OfficeDraft => {
  const dayCount =
    enablement.maximumDayCount === 0
      ? draft.dayCount
      : Math.min(Math.max(draft.dayCount, 1), enablement.maximumDayCount);
  const seats = Math.min(Math.max(draft.seats, 1), enablement.maximumSeats);
  return dayCount === draft.dayCount && seats === draft.seats
    ? draft
    : { ...draft, dayCount, seats };
};
