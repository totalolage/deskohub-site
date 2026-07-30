import { Effect } from "effect";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { type Locale, m } from "@/features/i18n";
import { loadInitialAdvertisedPrices } from "@/features/reservation/backend/initial-advertised-prices.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import {
  getCoworkCoffeeAdvertisedPriceRequest,
  getCoworkTierAdvertisedPriceRequests,
} from "@/features/reservation/cowork-advertised-price";
import { getCoworkTierRequiresMonitorOption } from "@/features/reservation/cowork-reservation";
import {
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import { getCurrentPragueDate } from "@/features/reservation/reservation-date";
import { coworkReservationPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  CoworkReservationForm,
  CoworkReservationFormFallback,
} from "./cowork-reservation-form";

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
    const restoredOrQueryValues = initialReservation
      ? getReservationDefaultValuesFromPayState(initialReservation)
      : getReservationDefaultValuesFromSearchParams(searchParams);
    const initialValues = restoredOrQueryValues.date
      ? restoredOrQueryValues
      : { ...restoredOrQueryValues, date: getCurrentPragueDate() };
    const initialAdvertisedPriceRequests = initialValues.date
      ? [
          ...getCoworkTierAdvertisedPriceRequests({
            coffee: Boolean(initialValues.coffee),
            date: initialValues.date,
            locale,
          }).map(({ request }) => request),
          getCoworkCoffeeAdvertisedPriceRequest({
            date: initialValues.date,
            locale,
            tier: initialValues.entryTier,
          }),
        ]
      : [];
    const initialAdvertisedPrices = await loadInitialAdvertisedPrices(
      initialAdvertisedPriceRequests
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
            initialValues.entryTier
          )}
        />
      ),
      children: (
        <CoworkReservationForm
          checkoutSessionId={checkoutSessionId}
          initialAdvertisedPrices={initialAdvertisedPrices}
          initialReservation={initialReservation}
          initialValues={initialValues}
          locale={locale}
        />
      ),
    };
  },
});
