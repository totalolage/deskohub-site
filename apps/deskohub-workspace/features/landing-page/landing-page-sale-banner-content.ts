import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import { type Locale, m } from "@/features/i18n";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { getReservationStartPath } from "@/features/reservation/routes";
import type { LandingPageSaleBannerContent } from "./components/landing-page-sale-banner";

type LandingPageSale = {
  readonly title: string;
  readonly adjustment: DiscountAdjustment;
  readonly products: readonly WorkspaceProductTarget[];
};

export function getLandingPageSaleBannerContent({
  locale,
  reservationKind,
  sale,
}: {
  locale: Locale;
  reservationKind: ReservationOrderData["kind"];
  sale: LandingPageSale;
}): LandingPageSaleBannerContent {
  return {
    label: formatLandingPageSaleBannerLabel(sale, locale),
    adjustmentKind: sale.adjustment.kind,
    statusLabel: m.landingSaleBannerStatus({}, { locale }),
    ctaLabel: m.landingSaleBannerCta({}, { locale }),
    href: getReservationStartPath(
      locale,
      reservationKind,
      new URLSearchParams({
        utm_source: "deskohub",
        utm_medium: "sale_banner",
        utm_content: "home_hero",
      })
    ),
  };
}

export function formatLandingPageSaleBannerLabel(
  sale: LandingPageSale,
  locale: Locale
) {
  const productKinds = new Set(sale.products.map(({ kind }) => kind));
  const values = {
    title: sale.title,
    adjustment: formatDiscountAdjustment(sale.adjustment, locale),
  };

  if (productKinds.size === 3) {
    return m.landingSaleBannerAllProducts(values, { locale });
  }

  if (productKinds.size === 1 && productKinds.has("cowork")) {
    return m.landingSaleBannerAllCoworkProducts(values, { locale });
  }

  if (productKinds.size === 1 && productKinds.has("meeting-room")) {
    return m.landingSaleBannerAllMeetingRoomProducts(values, { locale });
  }

  return m.landingSaleBannerSelectedProducts(values, { locale });
}
