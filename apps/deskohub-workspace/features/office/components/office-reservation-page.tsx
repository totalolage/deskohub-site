import { Effect, Schema } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import { loadOfficeReservationSeatCapacity } from "@/features/office/backend/office-reservation-capacity.server";
import { isOfficePageEnabled } from "@/features/office/backend/office-reservation-feature-flag.server";
import { loadAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import {
  getOfficeReservationDefaultValues,
  getOfficeReservationEndsOn,
  type NormalizedOfficeReservationOrder,
} from "@/features/reservation/office-reservation";
import { getOfficeReservationDefaultValuesFromSearchParams } from "@/features/reservation/reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { officeReservationPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import type { SearchParamsRecord } from "@/shared/utils";
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
  render: renderOfficeReservationContent,
});

export async function renderOfficeReservationContent({
  checkoutSessionId,
  initialReservation,
  locale,
  replacementToken,
  searchParams,
  submittedCode,
}: {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly initialReservation?: NormalizedOfficeReservationOrder;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly searchParams: SearchParamsRecord;
  readonly submittedCode?: CanonicalPromotionCode;
}) {
  const today = decodePlainDate(getCurrentWorkspaceDate().toString());
  const seatCapacity = await loadOfficeReservationSeatCapacity();
  const restoredInitialValues = initialReservation
    ? getOfficeReservationDefaultValues(initialReservation)
    : undefined;
  const initialValues =
    restoredInitialValues ??
    getOfficeReservationDefaultValuesFromSearchParams(searchParams, {
      seatCapacity,
      startsOn: today,
    });
  const initialEndsOn = decodePlainDate(
    getOfficeReservationEndsOn(initialValues)
  );
  const initialAdvertisedPrices = await loadAdvertisedPrices([
    getOfficeAdvertisedPriceRequest({
      locale,
      startsOn: decodePlainDate(initialValues.startsOn),
      seats: initialValues.seats,
      submittedCode,
      endsOn: initialEndsOn,
    }),
  ]).pipe(
    Effect.provide(CheckoutPricingService.Live),
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
      submittedCode={submittedCode}
      today={today}
    />
  );
}
