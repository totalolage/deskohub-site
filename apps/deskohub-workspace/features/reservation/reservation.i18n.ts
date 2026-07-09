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
      tier:
        input.tier === "meeting-room"
          ? getWorkspaceMeetingRoomProductTitle(input.locale)
          : getWorkspaceProductTierTitle(input.tier, input.locale),
    },
    { locale: input.locale }
  );
};
