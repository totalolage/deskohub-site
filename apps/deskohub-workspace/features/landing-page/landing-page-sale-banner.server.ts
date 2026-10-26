import "server-only";
import { Effect } from "effect";
import type { ActiveSale } from "@/features/discounts";
import { getActivePublicSales } from "@/features/discounts/active-public-sales.server";
import {
  type WorkspaceProductFamily,
  workspaceProductFamilies,
} from "@/features/discounts/product-target";
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
    Effect.flatMap(getLandingPageSaleBanner),
    Effect.tapError((cause) =>
      Effect.logWarning("Landing sale banner lookup failed").pipe(
        Effect.annotateLogs({
          cause,
          landingPageBoundary: "sale_banner",
          landingPageErrorReason: "sale_lookup_failed",
        })
      )
    ),
    Effect.orElseSucceed(() => undefined)
  )
);

/**
 * The home page's sale banner for the sales running now: one sale on a
 * product visitors can book, or none.
 */
export const getLandingPageSaleBanner = Effect.fn("LandingPage.getSaleBanner")(
  (input: {
    readonly activeSales: readonly ActiveSale[];
    readonly locale: Locale;
  }) =>
    logAmbiguousActiveSales(input).pipe(
      Effect.andThen(getEligibleLandingPageSaleBanner(input))
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
  const bookableProducts = yield* getBookableProducts();
  const products = sale.products.filter(({ kind }) =>
    bookableProducts.includes(kind)
  );
  if (products.length === 0) return undefined;

  return toLandingPageSaleBannerContent({
    bookableProducts,
    locale: input.locale,
    sale: { ...sale, products },
  });
});

/** The product families visitors can reserve; offices only while switched on. */
const getBookableProducts = Effect.fn("LandingPage.getBookableProducts")(
  function* () {
    const officeFeatureFlag = yield* OfficeReservationFeatureFlagService;
    if (yield* officeFeatureFlag.isEnabled) return workspaceProductFamilies;

    return workspaceProductFamilies.filter((family) => family !== "office");
  }
);

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
  readonly bookableProducts: readonly WorkspaceProductFamily[];
  readonly locale: Locale;
  readonly sale: ActiveSale;
}): LandingPageSaleBannerContent =>
  getLandingPageSaleBannerContent({
    bookableProducts: input.bookableProducts,
    locale: input.locale,
    reservationKind: getBannerReservationKind(input.sale),
    sale: {
      id: input.sale.discount.id,
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
