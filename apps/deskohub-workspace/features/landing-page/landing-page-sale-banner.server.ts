import "server-only";
import { Clock, Effect } from "effect";
import { type ActiveSale, DiscountService } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import type { LandingPageSaleBannerContent } from "./components/landing-page-sale-banner";
import { getLandingPageSaleBannerContent } from "./landing-page-sale-banner-content";

export const getActiveLandingPageSaleBanner = Effect.fn(
  "LandingPage.getActiveSaleBanner"
)((input: { readonly locale: Locale }) =>
  Effect.succeed(input).pipe(
    Effect.bind("at", () => Clock.currentTimeMillis),
    Effect.let("reservationDate", ({ at }) =>
      getCurrentWorkspaceDate(Temporal.Instant.fromEpochMilliseconds(at))
    ),
    Effect.bind("activeSales", ({ locale, reservationDate }) =>
      Effect.flatMap(DiscountService, (discounts) =>
        discounts.discoverActiveSales({ locale, reservationDate })
      )
    ),
    Effect.tap(logAmbiguousActiveSales),
    Effect.map(({ activeSales, locale }) =>
      activeSales.length === 1
        ? toLandingPageSaleBannerContent({ locale, sale: activeSales[0]! })
        : undefined
    )
  )
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
): ReservationOrderData["kind"] =>
  sale.products.every(({ kind }) => kind === "meeting-room")
    ? "meeting-room"
    : "cowork";
