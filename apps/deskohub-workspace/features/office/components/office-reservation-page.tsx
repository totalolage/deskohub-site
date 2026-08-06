import { Effect, Schema } from "effect";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { type Locale, m } from "@/features/i18n";
import { loadOfficeReservationSeatCapacity } from "@/features/office/backend/office-reservation-capacity.server";
import { isOfficePageEnabled } from "@/features/office/backend/office-reservation-feature-flag.server";
import { loadAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getOfficeAdditionalSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
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
    const seatCapacity = await loadOfficeReservationSeatCapacity();
    const initialAdvertisedPrices = await loadAdvertisedPrices(
      getOfficeAdditionalSeatAdvertisedPriceRequests({
        seatCapacity,
        locale,
        startsOn: decodePlainDate(initialValues.startsOn),
        endsOn: decodePlainDate(initialValues.endsOn),
      }).map(({ request }) => request)
    ).pipe(
      Effect.provide(CheckoutPricingServiceLiveWithDependencies),
      Effect.scoped,
      runWorkspaceEffect("reservation.office.load-advertised-price")
    );

    return (
      <OfficeReservationForm
        checkoutSessionId={checkoutSessionId}
        seatCapacity={seatCapacity}
        initialAdvertisedPrices={initialAdvertisedPrices}
        initialReservation={initialReservation}
        initialValues={initialValues}
        locale={locale}
        replacementToken={replacementToken}
      />
    );
  },
});
