import { Effect, Schema } from "effect";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { type Locale, m } from "@/features/i18n";
import { isOfficePageEnabled } from "@/features/office/backend/office-reservation-feature-flag.server";
import { loadAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import {
  getOfficeReservationDefaultValues,
  officeReservationDefaultValues,
} from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { officeReservationPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  OfficeReservationForm,
  OfficeReservationFormFallback,
} from "./office-reservation-form";

const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);

export const officeReservationPage = createReservationPage({
  fallback: (locale) => <OfficeReservationFormFallback locale={locale} />,
  kind: "office",
  pathname: officeReservationPath,
  isEnabled: isOfficePageEnabled,
  metadata: (locale: Locale) => ({
    title: m.reservationOfficeMetadataTitle({}, { locale }),
    description: m.reservationOfficeMetadataDescription({}, { locale }),
  }),
  render: async ({
    checkoutSessionId,
    initialReservation,
    locale,
    replacementToken,
  }) => {
    const today = decodePlainDate(getCurrentWorkspaceDate().toString());
    const restoredInitialValues = initialReservation
      ? getOfficeReservationDefaultValues(initialReservation)
      : undefined;
    const initialValues = restoredInitialValues ?? {
      ...officeReservationDefaultValues,
      startsOn: today,
      endsOn: today,
    };
    const initialAdvertisedPrices = await loadAdvertisedPrices([
      getOfficeAdvertisedPriceRequest({
        locale,
        startsOn: decodePlainDate(initialValues.startsOn),
        endsOn: decodePlainDate(initialValues.endsOn),
        additionalGuests: initialValues.additionalGuests,
      }),
    ]).pipe(
      Effect.provide(CheckoutPricingServiceLiveWithDependencies),
      Effect.scoped,
      runWorkspaceEffect("reservation.office.load-advertised-price")
    );

    return (
      <OfficeReservationForm
        checkoutSessionId={checkoutSessionId}
        initialAdvertisedPrices={initialAdvertisedPrices}
        initialReservation={initialReservation}
        initialValues={initialValues}
        locale={locale}
        replacementToken={replacementToken}
      />
    );
  },
});
