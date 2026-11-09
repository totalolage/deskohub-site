import type { CustomerReservationKind } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import {
  formatInstantRange,
  formatWorkspaceDays,
  parseInstant,
} from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";

/** What a reservation's period is read from, in the history or an order. */
export interface ReservationPeriod {
  /** `other` for a history product the app doesn't know. */
  readonly kind: CustomerReservationKind | "other";
  readonly startsAt?: string | null;
  readonly endsAt?: string | null;
}

const instantOf = (iso: string | null | undefined) =>
  Option.flatMap(Option.fromNullishOr(iso), parseInstant);

/**
 * A reservation's period as the site's account page shows it. Office and
 * cowork bookings are whole days, so they show the day, or the first and last
 * day, without times; a meeting room shows its start and end times. Unreadable
 * or missing times show as unavailable.
 */
export const reservationPeriodText = (
  { kind, startsAt, endsAt }: ReservationPeriod,
  locale: AppLocale
): string =>
  Option.match(Option.all([instantOf(startsAt), instantOf(endsAt)]), {
    onNone: () => m.reservations_value_unavailable({}, { locale }),
    onSome: ([start, end]) => {
      const range =
        kind === "office" || kind === "cowork"
          ? formatWorkspaceDays(start, end, locale)
          : formatInstantRange(start, end, locale);
      return Option.match(range.end, {
        onNone: () => range.start,
        onSome: (last) =>
          m.reservations_time_range(
            { start: range.start, end: last },
            { locale }
          ),
      });
    },
  });
