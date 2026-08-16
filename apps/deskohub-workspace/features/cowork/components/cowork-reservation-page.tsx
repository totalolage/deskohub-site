import { Effect } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import { loadAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getCoworkTierAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import type { NormalizedCoworkReservationOrder } from "@/features/reservation/cowork-reservation";
import {
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { coworkReservationPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import type { SearchParamsRecord } from "@/shared/utils";
import {
  CoworkReservationForm,
  CoworkReservationFormFallback,
} from "./cowork-reservation-form";

export const coworkReservationPage = createReservationPage({
  fallback: (locale) => <CoworkReservationFormFallback locale={locale} />,
  kind: "cowork",
  pathname: coworkReservationPath,
  metadata: (locale: Locale) => ({
    title: m.checkoutOrderMetadataTitle({}, { locale }),
    description: m.checkoutOrderMetadataDescription({}, { locale }),
  }),
  render: renderCoworkReservationContent,
});

export async function renderCoworkReservationContent({
  checkoutSessionId,
  initialReservation,
  locale,
  replacementToken,
  searchParams,
  submittedCode,
}: {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly initialReservation?: NormalizedCoworkReservationOrder;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly searchParams: SearchParamsRecord;
  readonly submittedCode?: CanonicalPromotionCode;
}) {
  const restoredOrQueryValues = initialReservation
    ? getReservationDefaultValuesFromPayState(initialReservation)
    : getReservationDefaultValuesFromSearchParams(searchParams);
  const initialValues = restoredOrQueryValues.date
    ? restoredOrQueryValues
    : {
        ...restoredOrQueryValues,
        date: getCurrentWorkspaceDate().toString(),
      };
  const initialAdvertisedPrices = await loadAdvertisedPrices(
    getCoworkTierAdvertisedPriceRequests({
      coffee: initialValues.coffee,
      date: initialValues.date,
      locale,
      submittedCode,
    }).filter(
      ({ reservation }) =>
        reservation.details.entryTier === initialValues.entryTier
    )
  ).pipe(
    Effect.provide(CheckoutPricingService.Live),
    Effect.scoped,
    runWorkspaceEffect("reservation.cowork.load-advertised-price")
  );

  return (
    <CoworkReservationForm
      checkoutSessionId={checkoutSessionId}
      initialAdvertisedPrices={initialAdvertisedPrices}
      initialReservation={initialReservation}
      initialValues={initialValues}
      locale={locale}
      replacementToken={replacementToken}
      submittedCode={submittedCode}
    />
  );
}
