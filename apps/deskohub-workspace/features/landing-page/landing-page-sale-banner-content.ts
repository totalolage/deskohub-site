import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import {
  workspaceCoworkProductTiers,
  workspaceMeetingRoomCatalog,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import { type Locale, m } from "@/features/i18n";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { getReservationStartPath } from "@/features/reservation/routes";
import type { LandingPageSaleBannerContent } from "./components/landing-page-sale-banner";

type LandingPageSale = {
  readonly title: string;
  readonly adjustment: DiscountAdjustment;
  readonly products: readonly WorkspaceProductIdentity[];
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
  const productKeys = new Set(sale.products.map(getWorkspaceProductKey));
  const coworkCount = workspaceCoworkProductTiers.filter((tier) =>
    productKeys.has(`cowork:${tier}`)
  ).length;
  const meetingRoomCount = workspaceMeetingRoomCatalog.filter(({ duration }) =>
    productKeys.has(getWorkspaceProductKey({ kind: "meeting-room", duration }))
  ).length;
  const hasAllCoworkProducts =
    coworkCount === workspaceCoworkProductTiers.length;
  const hasAllMeetingRoomProducts =
    meetingRoomCount === workspaceMeetingRoomCatalog.length;
  const values = {
    title: sale.title,
    adjustment: formatDiscountAdjustment(sale.adjustment, locale),
  };

  if (hasAllCoworkProducts && hasAllMeetingRoomProducts) {
    return m.landingSaleBannerAllProducts(values, { locale });
  }

  if (hasAllCoworkProducts && meetingRoomCount === 0) {
    return m.landingSaleBannerAllCoworkProducts(values, { locale });
  }

  if (coworkCount === 0 && hasAllMeetingRoomProducts) {
    return m.landingSaleBannerAllMeetingRoomProducts(values, { locale });
  }

  if (hasAllCoworkProducts && meetingRoomCount > 0) {
    return m.landingSaleBannerAllCoworkAndSelectedMeetingRoomProducts(values, {
      locale,
    });
  }

  if (coworkCount > 0 && hasAllMeetingRoomProducts) {
    return m.landingSaleBannerSelectedCoworkAndAllMeetingRoomProducts(values, {
      locale,
    });
  }

  return m.landingSaleBannerSelectedProducts(values, { locale });
}
