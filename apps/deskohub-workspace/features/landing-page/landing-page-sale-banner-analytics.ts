import type { DiscountId } from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { isConsentCategoryAcceptedInCookie } from "@/shared/utils/consent-cookie";

/** A visitor followed the home page sale banner to a reservation form. */
export const SALE_BANNER_CLICKED_EVENT = "sale banner clicked";

/** What a sale banner click reports about the sale it advertised. */
export type LandingPageSaleBannerClick = {
  readonly discountId: DiscountId;
  readonly locale: Locale;
  readonly reservationKind: ReservationOrderData["kind"];
};

/**
 * Captures a sale banner click when the visitor accepted analytics. The
 * banner loads posthog-js on click, so it adds nothing to the page's initial
 * JavaScript. The capture is best effort: a failed load drops the event and
 * never affects the navigation.
 */
export const captureSaleBannerClick = ({
  discountId,
  locale,
  reservationKind,
}: LandingPageSaleBannerClick): void => {
  if (
    globalThis.document === undefined ||
    !isConsentCategoryAcceptedInCookie(globalThis.document.cookie, "analytics")
  ) {
    return;
  }
  import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.capture(SALE_BANNER_CLICKED_EVENT, {
        discount_id: discountId,
        locale,
        reservation_kind: reservationKind,
      });
    })
    .catch(() => undefined);
};
