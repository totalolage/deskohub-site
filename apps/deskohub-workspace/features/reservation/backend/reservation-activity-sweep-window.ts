import "@/shared/polyfills/temporal";

import { Option } from "effect";
import type { CustomerEventSweepSource } from "@/shared/backend/customer-events/customer-event";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { floorToWholeHour } from "@/shared/utils/temporal";

/** A sweep window `(startsAt, endsAt]` of reservation activity. */
export type ReservationActivityWindow = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
};

/** One Dotypos page of a sweep source's open window. */
export type ReservationActivityPage = {
  readonly source: CustomerEventSweepSource;
  readonly window: ReservationActivityWindow;
  readonly page: number;
};

/** Re-sweeps the end of the previous window, so rows written late still land. */
const windowOverlap = Temporal.Duration.from({ minutes: 2 });
/** Bounds one window, so catch-up after an outage pages in steps. */
const longestWindow = Temporal.Duration.from({ hours: 6 });
/** How far back the hourly reconcile re-pages. */
const reconcileLookback = Temporal.Duration.from({ hours: 24 });
/** A closed window chains to the next one at once when the sweep lags more. */
const chainingLag = Temporal.Duration.from({ minutes: 1 });

const earlierOf = (left: Temporal.Instant, right: Temporal.Instant) =>
  Temporal.Instant.compare(left, right) <= 0 ? left : right;

const workspaceHourStart = (at: Temporal.Instant) =>
  floorToWholeHour(
    at.toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
  ).toInstant();

/**
 * Window bounds are whole milliseconds, so they survive storage and an ISO
 * work-unit subject unchanged and compare equal in the cursor CAS.
 */
const toWindowBound = (value: Temporal.Instant) =>
  value.round({ smallestUnit: "millisecond", roundingMode: "trunc" });

const storedWindow = (
  startsAt: Temporal.Instant,
  endsAt: Temporal.Instant
): ReservationActivityWindow => ({
  startsAt: toWindowBound(startsAt),
  endsAt: toWindowBound(endsAt),
});

/**
 * The window a source with no open window should page at `at`, if any.
 *
 * `reservation-activity` follows the clock from `sweptUntil`, at most six
 * hours at a time. `reservation-activity-reconcile` re-pages the last 24
 * hours once per Workspace-local hour: its `sweptUntil` is the instant its
 * last window opened, so it is due again on the first run of a later hour.
 */
export const dueReservationActivityWindow = (
  source: CustomerEventSweepSource,
  sweptUntil: Temporal.Instant,
  at: Temporal.Instant
): Option.Option<ReservationActivityWindow> => {
  switch (source) {
    case "reservation-activity": {
      const window = storedWindow(
        sweptUntil.subtract(windowOverlap),
        earlierOf(at, sweptUntil.add(longestWindow))
      );
      return Temporal.Instant.compare(sweptUntil, window.endsAt) < 0
        ? Option.some(window)
        : Option.none();
    }
    case "reservation-activity-reconcile":
      return Temporal.Instant.compare(sweptUntil, workspaceHourStart(at)) < 0
        ? Option.some(storedWindow(at.subtract(reconcileLookback), at))
        : Option.none();
  }
};

/**
 * The window to open as soon as `closed` is fully paged: only the clock
 * sweep chains, and only while it lags `at` by more than a minute.
 */
export const chainedReservationActivityWindow = (
  source: CustomerEventSweepSource,
  closed: ReservationActivityWindow,
  at: Temporal.Instant
): Option.Option<ReservationActivityWindow> =>
  source === "reservation-activity" &&
  Temporal.Instant.compare(closed.endsAt.add(chainingLag), at) < 0
    ? dueReservationActivityWindow(source, closed.endsAt, at)
    : Option.none();
