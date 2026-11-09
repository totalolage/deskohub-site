import type { CustomerReservationAccess } from "@deskohub/workspace-customer-api";
import { Data, DateTime, Duration, Option } from "effect";
import { parseInstant } from "../../i18n/date-time-format";

/** When the door lock accepts an order's PIN. */
export interface AccessWindow {
  readonly startsAt: DateTime.Utc;
  readonly endsAt: DateTime.Utc;
}

/** The lock's window of an access answer; none when a time is unreadable. */
export const accessWindowOf = (
  access: Pick<CustomerReservationAccess, "accessStartsAt" | "accessEndsAt">
): Option.Option<AccessWindow> =>
  Option.all({
    startsAt: parseInstant(access.accessStartsAt),
    endsAt: parseInstant(access.accessEndsAt),
  });

/** Where a moment falls in the lock's window, with the time left to wait. */
export type AccessWindowState = Data.TaggedEnum<{
  /** The lock doesn't accept the PIN yet. */
  Upcoming: { readonly startsIn: Duration.Duration };
  /** The lock accepts the PIN. */
  Open: { readonly remaining: Duration.Duration };
  /** The lock no longer accepts the PIN. */
  Ended: Record<never, never>;
}>;

export const AccessWindowState = Data.taggedEnum<AccessWindowState>();

/**
 * The window's state at `now`. The window includes its start and excludes
 * its end: the PIN works from `start` and stops working at `end`.
 */
export const accessWindowState = (
  now: DateTime.Utc,
  start: DateTime.Utc,
  end: DateTime.Utc
): AccessWindowState => {
  if (DateTime.isLessThan(now, start)) {
    return AccessWindowState.Upcoming({
      startsIn: DateTime.distance(now, start),
    });
  }
  if (DateTime.isLessThan(now, end)) {
    return AccessWindowState.Open({ remaining: DateTime.distance(now, end) });
  }
  return AccessWindowState.Ended();
};

/**
 * A countdown's two largest units in whole numbers. Seconds round up, so a
 * countdown still running never reads zero.
 */
export type Countdown = Data.TaggedEnum<{
  Days: { readonly days: number; readonly hours: number };
  Hours: { readonly hours: number; readonly minutes: number };
  Minutes: { readonly minutes: number; readonly seconds: number };
  Seconds: { readonly seconds: number };
}>;

export const Countdown = Data.taggedEnum<Countdown>();

const secondsPer = { day: 86_400, hour: 3_600, minute: 60 } as const;

export const countdownOf = (duration: Duration.Duration): Countdown => {
  const total = Math.max(0, Math.ceil(Duration.toMillis(duration) / 1_000));
  const days = Math.floor(total / secondsPer.day);
  const hours = Math.floor((total % secondsPer.day) / secondsPer.hour);
  const minutes = Math.floor((total % secondsPer.hour) / secondsPer.minute);
  const seconds = total % secondsPer.minute;
  if (days > 0) return Countdown.Days({ days, hours });
  if (hours > 0) return Countdown.Hours({ hours, minutes });
  if (minutes > 0) return Countdown.Minutes({ minutes, seconds });
  return Countdown.Seconds({ seconds });
};
