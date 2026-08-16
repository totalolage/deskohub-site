import "server-only";
import { Effect } from "effect";
import type { ActiveSale } from "@/features/discounts";
import { getActivePublicSales } from "@/features/discounts/active-public-sales.server";
import type { Locale } from "@/features/i18n";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import type { LandingPageSaleBannerContent } from "./components/landing-page-sale-banner";
import { getLandingPageSaleBannerContent } from "./landing-page-sale-banner-content";

export const getActiveLandingPageSaleBanner = Effect.fn(
  "LandingPage.getActiveSaleBanner"
)((input: { readonly locale: Locale }) =>
  Effect.succeed(input).pipe(
    Effect.bind("activeSales", ({ locale }) =>
      getActivePublicSales({ locale })
    ),
    Effect.tap(logAmbiguousActiveSales),
    Effect.flatMap(getEligibleLandingPageSaleBanner)
  )
);

const getEligibleLandingPageSaleBanner = Effect.fn(
  "LandingPage.getEligibleSaleBanner"
)(function* (input: {
  readonly activeSales: readonly ActiveSale[];
  readonly locale: Locale;
}) {
  if (input.activeSales.length !== 1) return undefined;

  const sale = input.activeSales[0];
  if (!sale) return undefined;
  if (sale.products.some(({ kind }) => kind === "office")) {
    const officeFeatureFlag = yield* OfficeReservationFeatureFlagService;
    if (!(yield* officeFeatureFlag.isEnabled)) return undefined;
  }

  return toLandingPageSaleBannerContent({ locale: input.locale, sale });
});

const logAmbiguousActiveSales = (input: {
  readonly activeSales: readonly ActiveSale[];
}) =>
  Effect.logError("Landing sale banner requires one active sale").pipe(
    Effect.annotateLogs({
      landingPageBoundary: "sale_banner",
      landingPageErrorReason: "overlapping_active_sales",
      activeSaleCount: input.activeSales.length,
    }),
    Effect.when(Effect.succeed(input.activeSales.length > 1))
  );

const toLandingPageSaleBannerContent = (input: {
  readonly locale: Locale;
  readonly sale: ActiveSale;
}): LandingPageSaleBannerContent =>
  getLandingPageSaleBannerContent({
    locale: input.locale,
    reservationKind: getBannerReservationKind(input.sale),
    sale: {
      title: input.sale.discount.label,
      adjustment: input.sale.discount.adjustment,
      products: input.sale.products,
    },
  });

const getBannerReservationKind = (
  sale: ActiveSale
): ReservationOrderData["kind"] => {
  if (sale.products.some(({ kind }) => kind === "cowork")) return "cowork";
  if (sale.products.some(({ kind }) => kind === "meeting-room")) {
    return "meeting-room";
  }
  return "office";
};
