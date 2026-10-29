import { Match } from "effect";
import type { Locale } from "@/features/i18n";
import { coworkSelectionLink } from "@/features/reservation/cowork-selection-link";
import { meetingRoomSelectionLink } from "@/features/reservation/meeting-room-selection-link";
import { officeSelectionLink } from "@/features/reservation/office-selection-link";
import { setReservationSelectionSearchParams } from "@/features/reservation/reservation-checkout-query";
import {
  getReservationStartPath,
  getShareableReservationStartPath,
} from "@/features/reservation/routes";
import type { LinkedSelection } from "@/features/reservation/selection-link";

/**
 * A selection a reservation page link names, in any family. Parameters it
 * leaves out stay open for the page to fill.
 */
export type ReservationSelection =
  | LinkedSelection<typeof coworkSelectionLink>
  | LinkedSelection<typeof meetingRoomSelectionLink>
  | LinkedSelection<typeof officeSelectionLink>;

const getSelectionSearchParams = (selection: ReservationSelection) => {
  const searchParams = new URLSearchParams();
  setReservationSelectionSearchParams(
    searchParams,
    Match.value(selection).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: coworkSelectionLink.write,
        "meeting-room": meetingRoomSelectionLink.write,
        office: officeSelectionLink.write,
      })
    )
  );
  return searchParams;
};

/** A reservation page path in the app that opens with the selection prefilled. */
export const getSelectionPath = (
  locale: Locale,
  selection: ReservationSelection
) =>
  getReservationStartPath(
    locale,
    selection.kind,
    getSelectionSearchParams(selection)
  );

/**
 * A reservation page path without a locale prefix, for links shared outside
 * the app: the proxy opens them in the recipient's language.
 */
export const getShareableSelectionPath = (selection: ReservationSelection) =>
  getShareableReservationStartPath(
    selection.kind,
    getSelectionSearchParams(selection)
  );
