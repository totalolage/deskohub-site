import { Effect, Option } from "effect";
import type { PreloadedAdvertisedPrice } from "@/features/checkout/advertised-price";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { type Locale, m } from "@/features/i18n";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import {
  type CoworkTierAdvertisedPriceRequest,
  getCoworkTierAdvertisedPriceRequests,
} from "@/features/reservation/cowork-advertised-price";
import {
  coworkReservationDefaultValues,
  getCoworkTierRequiresMonitorOption,
} from "@/features/reservation/cowork-reservation";
import {
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import { coworkReservationPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  CoworkReservationForm,
  CoworkReservationFormFallback,
} from "./cowork-reservation-form";

const loadInitialAdvertisedPrices = Effect.fn(
  "coworkReservationPage.loadInitialAdvertisedPrices"
)(function* (requests: ReadonlyArray<CoworkTierAdvertisedPriceRequest>) {
  const results = yield* Effect.all(
    requests.map(({ request, tier }) =>
      buildAdvertisedPrice(request).pipe(
        Effect.tapError(() =>
          Effect.logError("Initial advertised price load failed", {
            productIdentity: { kind: "cowork", tier },
          })
        ),
        Effect.option,
        Effect.map(
          Option.map(
            (advertisedPrice): PreloadedAdvertisedPrice => ({
              request,
              advertisedPrice,
            })
          )
        )
      )
    ),
    { concurrency: "unbounded" }
  );

  return results.filter(Option.isSome).map(({ value }) => value);
});

export const coworkReservationPage = createReservationPage({
  kind: "cowork",
  pathname: coworkReservationPath,
  metadata: (locale: Locale) => ({
    title: m.checkoutOrderMetadataTitle({}, { locale }),
    description: m.checkoutOrderMetadataDescription({}, { locale }),
  }),
  render: async ({
    checkoutSessionId,
    initialReservation,
    locale,
    searchParams,
  }) => {
    const initialValues = initialReservation
      ? getReservationDefaultValuesFromPayState(initialReservation)
      : getReservationDefaultValuesFromSearchParams(searchParams);
    const initialAdvertisedPrices = await loadInitialAdvertisedPrices(
      initialValues.date
        ? getCoworkTierAdvertisedPriceRequests({
            coffee: Boolean(initialValues.coffee),
            date: initialValues.date,
            locale,
          })
        : []
    ).pipe(
      Effect.provide(CheckoutPricingServiceLiveWithDependencies),
      Effect.scoped,
      runWorkspaceEffect("reservation.cowork.load-advertised-prices")
    );

    return {
      fallback: (
        <CoworkReservationFormFallback
          locale={locale}
          showMonitorOption={getCoworkTierRequiresMonitorOption(
            initialReservation?.entryTier ??
              coworkReservationDefaultValues.entryTier
          )}
        />
      ),
      children: (
        <CoworkReservationForm
          checkoutSessionId={checkoutSessionId}
          initialAdvertisedPrices={initialAdvertisedPrices}
          initialReservation={initialReservation}
          locale={locale}
        />
      ),
    };
  },
});
