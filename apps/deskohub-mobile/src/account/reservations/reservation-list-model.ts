import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Array as Arr, DateTime, Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant, parseInstant } from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";
import { opensReservationStatus } from "../account-gating";
import {
  reservationProductTitle,
  reservationStatusLabel,
} from "./reservation-labels";
import { reservationPeriodText } from "./reservation-period";
import type {
  SavedReservation,
  SavedReservationHistory,
} from "./reservations-cache";

/**
 * A reservation the list shows. A fresh history row has more (the other
 * party), which the list doesn't show; saved rows have only this.
 */
export type ReservationListRow = SavedReservation;

/** The list's groups, as the site's account page shows them. */
export interface ReservationGroups {
  /** The current reservation shown large, the first of the current ones. */
  readonly featured: Option.Option<ReservationListRow>;
  /** The other current and upcoming reservations, as compact rows. */
  readonly moreCurrent: ReadonlyArray<ReservationListRow>;
  readonly past: ReadonlyArray<ReservationListRow>;
  /** Reservations whose time couldn't be read. */
  readonly undated: ReadonlyArray<ReservationListRow>;
  /** Whether the account has no reservations at all. */
  readonly empty: boolean;
}

const instantOf = (iso: string | null | undefined) =>
  Option.flatMap(Option.fromNullishOr(iso), parseInstant);

const hasEndedBy =
  (now: DateTime.DateTime) =>
  ({ endsAt }: ReservationListRow) =>
    Option.exists(instantOf(endsAt), (end) =>
      DateTime.isLessThanOrEqualTo(end, now)
    );

/**
 * Groups a history at `now`. A current reservation stays current until it
 * ends; one that has ended since the history was read (a saved history read
 * later) moves to the top of the past ones.
 */
export const reservationGroups = (
  history: SavedReservationHistory,
  now: DateTime.DateTime
): ReservationGroups => {
  const ended = history.current.filter(hasEndedBy(now));
  const current = history.current.filter((row) => !ended.includes(row));
  const past = [...ended, ...history.past];
  return {
    featured: Arr.head(current),
    moreCurrent: current.slice(1),
    past,
    undated: history.unavailable,
    empty:
      current.length === 0 &&
      past.length === 0 &&
      history.unavailable.length === 0,
  };
};

/** One reservation's text, formatted for the locale. */
export interface ReservationRowText {
  readonly title: string;
  /** Its days or times, or "unavailable" when either end can't be read. */
  readonly period: string;
  /** When early setup starts, for a meeting room booked with it. */
  readonly setup: Option.Option<string>;
  readonly seats: string;
  readonly status: string;
}

export const reservationRowText = (
  row: ReservationListRow,
  locale: AppLocale
): ReservationRowText => ({
  title: reservationProductTitle(row.product, locale),
  period: reservationPeriodText(
    { kind: row.product.kind, startsAt: row.startsAt, endsAt: row.endsAt },
    locale
  ),
  setup: Option.map(instantOf(row.setupStartsAt), (setup) =>
    m.reservations_setup_from(
      { time: formatInstant(setup, locale, "time") },
      { locale }
    )
  ),
  seats:
    row.seats === null
      ? m.reservations_seats_unavailable({}, { locale })
      : m.reservations_seats({ count: row.seats }, { locale }),
  status: reservationStatusLabel(row.status, locale),
});

/** The order a row opens the status screen of; none when it isn't navigable. */
export const reservationStatusTarget = (
  row: ReservationListRow
): Option.Option<CustomerReservationOrderId> =>
  opensReservationStatus(row)
    ? Option.fromNullishOr(row.orderId)
    : Option.none();
