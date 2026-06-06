import type { WorkspaceProductTier } from "@/features/checkout/product-catalog";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayDate } from "@/features/reservation/reservation-date";

export const getReservationAvailabilityUnavailableMessage = (input: {
  readonly date: string;
  readonly dateFallback?: string;
  readonly locale: Locale;
  readonly tier: WorkspaceProductTier;
}) =>
  m.reservationAvailabilityUnavailable(
    {
      date: formatReservationDisplayDate(
        input.date,
        input.locale,
        input.dateFallback
      ),
      tier: getWorkspaceProductTierTitle(input.tier, input.locale),
    },
    { locale: input.locale }
  );
