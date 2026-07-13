import { Match } from "effect";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import {
  formatReservationDisplayDate,
  parseReservationInputDate,
} from "@/features/reservation/reservation-date";

type ReservationAvailabilityUnavailableMessageInput = {
  readonly date: string;
  readonly dateFallback?: string;
  readonly locale: Locale;
} & (
  | {
      readonly reservation:
        | {
            readonly _tag: "cowork";
            readonly tier: WorkspaceCoworkProductTier;
          }
        | {
            readonly _tag: "meeting-room";
          };
    }
  | {
      readonly tier: WorkspaceCoworkProductTier;
    }
);

export const getReservationAvailabilityUnavailableMessage = (
  input: ReservationAvailabilityUnavailableMessageInput
) => {
  const plainDate = parseReservationInputDate(input.date);
  const reservation =
    "reservation" in input
      ? input.reservation
      : ({ _tag: "cowork", tier: input.tier } as const);

  return m.reservationAvailabilityUnavailable(
    {
      date: plainDate
        ? formatReservationDisplayDate(
            plainDate,
            input.locale,
            input.dateFallback
          )
        : (input.dateFallback ?? input.date),
      tier: Match.value(reservation).pipe(
        Match.tag("meeting-room", () =>
          getWorkspaceMeetingRoomProductTitle(input.locale)
        ),
        Match.tag("cowork", (reservation) =>
          getWorkspaceProductTierTitle(reservation.tier, input.locale)
        ),
        Match.exhaustive
      ),
    },
    { locale: input.locale }
  );
};
