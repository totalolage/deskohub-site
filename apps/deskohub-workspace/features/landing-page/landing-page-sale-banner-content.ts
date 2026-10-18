import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import {
  type WorkspaceProductFamily,
  type WorkspaceProductTarget,
  workspaceProductTargetsCoverFamily,
} from "@/features/discounts/product-target";
import { type Locale, m } from "@/features/i18n";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { getReservationStartPath } from "@/features/reservation/routes";
import type {
  LandingPageSaleBannerContent,
  LandingPageSaleBannerLabel,
} from "./components/landing-page-sale-banner";

type LandingPageSale = {
  readonly title: string;
  readonly adjustment: DiscountAdjustment;
  readonly products: readonly WorkspaceProductTarget[];
};

export function getLandingPageSaleBannerContent({
  bookableProducts,
  locale,
  reservationKind,
  sale,
}: {
  bookableProducts: readonly WorkspaceProductFamily[];
  locale: Locale;
  reservationKind: ReservationOrderData["kind"];
  sale: LandingPageSale;
}): LandingPageSaleBannerContent {
  return {
    label: getLandingPageSaleBannerLabel(sale, locale, bookableProducts),
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

/**
 * A sale covering every product family visitors can currently book is a sale
 * on all products, even when other families are switched off.
 */
export function getLandingPageSaleBannerLabel(
  sale: LandingPageSale,
  locale: Locale,
  bookableProducts: readonly WorkspaceProductFamily[]
): LandingPageSaleBannerLabel {
  return {
    template: getLandingPageSaleBannerTemplate(
      sale.products,
      locale,
      bookableProducts
    ),
    title: sale.title,
    adjustment: formatDiscountAdjustment(sale.adjustment, locale),
  };
}

function getLandingPageSaleBannerTemplate(
  products: LandingPageSale["products"],
  locale: Locale,
  bookableProducts: readonly WorkspaceProductFamily[]
) {
  const productKinds = new Set(products.map(({ kind }) => kind));
  const coversAll = (kind: WorkspaceProductFamily) =>
    workspaceProductTargetsCoverFamily(products, kind);
  const placeholders = { title: "{title}", adjustment: "{adjustment}" };

  if (bookableProducts.every(coversAll)) {
    return m.landingSaleBannerAllProducts(placeholders, { locale });
  }

  if (productKinds.size === 1 && coversAll("cowork")) {
    return m.landingSaleBannerAllCoworkProducts(placeholders, { locale });
  }

  if (productKinds.size === 1 && productKinds.has("meeting-room")) {
    return m.landingSaleBannerAllMeetingRoomProducts(placeholders, { locale });
  }

  return m.landingSaleBannerSelectedProducts(placeholders, { locale });
}
