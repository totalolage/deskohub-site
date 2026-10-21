import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import type { Locale } from "@/features/i18n";
import { checkAvailabilityResultSchema } from "../check-availability.schema";
import { getQuoteResultSchema } from "../get-quote.schema";
import { startReservationResultSchema } from "../start-reservation.schema";
import {
  type BookingSelection,
  type BookingStart,
  withRequiredWorkstation,
} from "./booking-draft";
import { BookingHost } from "./booking-host";

const bookingRuntime = Atom.runtime(BookingHost.Live);

/** The view's language, for every message it shows, startup failures included. */
export const bookingLocaleAtom = bookingRuntime
  .atom(Effect.service(BookingHost).pipe(Effect.flatMap((host) => host.locale)))
  .pipe(Atom.keepAlive);

/** The `show_booking` result the view opens with. */
export const bookingStartAtom = bookingRuntime
  .atom(Effect.service(BookingHost).pipe(Effect.flatMap((host) => host.start)))
  .pipe(Atom.keepAlive);

/**
 * Checks whether the selection looks free and, when it does, quotes it as it
 * would be booked. The booking reuses the quoted selection.
 */
export const bookingCheckAtom = bookingRuntime.fn(
  Effect.fn("bookingWidget.check")(function* ({
    selection,
    start,
  }: {
    readonly selection: BookingSelection;
    readonly start: BookingStart;
  }) {
    const host = yield* BookingHost;
    const availability = yield* host.callTool(
      "check_availability",
      { ...selection, locale: start.locale },
      checkAvailabilityResultSchema
    );
    if (!availability.available) return { availability };
    const quoted = withRequiredWorkstation(
      selection,
      availability,
      start.offerings
    );
    const quote = yield* host.callTool(
      "get_quote",
      { ...quoted, locale: start.locale },
      getQuoteResultSchema
    );
    return { availability, quote, selection: quoted };
  })
);

/**
 * Holds the quoted selection for the signed-in customer. The view never
 * sends `marketing_consent`: only the customer's explicit request to the
 * agent grants it.
 */
export const bookingReserveAtom = bookingRuntime.fn(
  ({
    selection,
    locale,
  }: {
    readonly selection: BookingSelection;
    readonly locale: Locale;
  }) =>
    BookingHost.use((host) =>
      host.callTool(
        "start_reservation",
        { ...selection, locale },
        startReservationResultSchema
      )
    )
);

/** Opens a site page through the host. */
export const bookingLinkAtom = bookingRuntime.fn((url: string) =>
  BookingHost.use((host) => host.openLink(url))
);
