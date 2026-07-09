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

export const getReservationAvailabilityUnavailableMessage = (input: {
  readonly date: string;
  readonly dateFallback?: string;
  readonly locale: Locale;
  readonly tier: WorkspaceCoworkProductTier | "meeting-room";
}) => {
  const plainDate = parseReservationInputDate(input.date);

  return m.reservationAvailabilityUnavailable(
    {
      date: plainDate
        ? formatReservationDisplayDate(
            plainDate,
            input.locale,
            input.dateFallback
          )
        : (input.dateFallback ?? input.date),
      tier: Match.value(input.tier).pipe(
        Match.when("meeting-room", () =>
          getWorkspaceMeetingRoomProductTitle(input.locale)
        ),
        Match.when("basic", (tier) =>
          getWorkspaceProductTierTitle(tier, input.locale)
        ),
        Match.when("plus", (tier) =>
          getWorkspaceProductTierTitle(tier, input.locale)
        ),
        Match.when("profi", (tier) =>
          getWorkspaceProductTierTitle(tier, input.locale)
        ),
        Match.exhaustive
      ),
    },
    { locale: input.locale }
  );
};
