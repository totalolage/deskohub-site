import { Schema } from "effect";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import { loadOfficeReservationSeatCapacity } from "@/features/office/backend/office-reservation-capacity.server";
import { isOfficePageEnabled } from "@/features/office/backend/office-reservation-feature-flag.server";
import { preloadPageAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { preloadPageAvailability } from "@/features/reservation/backend/workspace-availability-loader";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getOfficeSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
import {
  getOfficeReservationDefaultValues,
  getOfficeReservationEndsOn,
  type NormalizedOfficeReservationOrder,
} from "@/features/reservation/office-reservation";
import { getOfficeReservationDefaultValuesFromSearchParams } from "@/features/reservation/office-reservation-checkout-query";
import { getReservationCustomerQueryMode } from "@/features/reservation/reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  getReservationExistingCustomerForm,
  type ReservationExistingCustomer,
} from "@/features/reservation/reservation-existing-customer";
import { officeReservationPath } from "@/features/reservation/routes";
import { getOfficeAvailabilityQuery } from "@/features/reservation/workspace-availability";
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
  loadPageData: loadOfficeReservationSeatCapacity,
  metadata: (locale: Locale) => ({
    title: m.reservationOfficeMetadataTitle({}, { locale }),
    description: m.reservationOfficeMetadataDescription({}, { locale }),
  }),
  render: renderOfficeReservationContent,
});

export async function renderOfficeReservationContent({
  checkoutSessionId,
  existingCustomer,
  initialReservation,
  locale,
  pageData: seatCapacity,
  replacementToken,
  searchParams,
  submittedCode,
}: {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly existingCustomer?: ReservationExistingCustomer<"office">;
  readonly initialReservation?: NormalizedOfficeReservationOrder;
  readonly locale: Locale;
  /** The office seat capacity, loaded alongside the existing customer. */
  readonly pageData: number;
  readonly replacementToken?: string;
  readonly searchParams: SearchParamsRecord;
  readonly submittedCode?: CanonicalPromotionCode;
}) {
  const today = decodePlainDate(getCurrentWorkspaceDate().toString());
  const restoredInitialValues = initialReservation
    ? getOfficeReservationDefaultValues(initialReservation)
    : undefined;
  const restoredOrQueryValues =
    restoredInitialValues ??
    getOfficeReservationDefaultValuesFromSearchParams(searchParams, {
      lastReservation: existingCustomer?.lastReservation,
      seatCapacity,
      today,
    });
  const { existingCustomer: existingCustomerForm, initialValues } =
    existingCustomer
      ? getReservationExistingCustomerForm({
          contact: existingCustomer.contact,
          hasMarketingConsent: existingCustomer.hasMarketingConsent,
          // Office links never prefill a contact, so only an explicit
          // `customer` parameter chooses the mode.
          queryMode: getReservationCustomerQueryMode(searchParams, {
            prefillsContact: false,
          }),
          restored: Boolean(restoredInitialValues),
          values: restoredOrQueryValues,
        })
      : { existingCustomer: undefined, initialValues: restoredOrQueryValues };
  const initialEndsOn = decodePlainDate(
    getOfficeReservationEndsOn(initialValues)
  );
  const [initialAdvertisedPrices, initialAvailability] = await Promise.all([
    preloadPageAdvertisedPrices(
      getOfficeSeatAdvertisedPriceRequests({
        locale,
        seatCapacity,
        startsOn: decodePlainDate(initialValues.startsOn),
        endsOn: initialEndsOn,
        submittedCode,
      })
    ).pipe(runWorkspaceEffect("reservation.office.load-advertised-price")),
    preloadPageAvailability({
      queries: [getOfficeAvailabilityQuery(today)],
      replacementToken,
    }).pipe(runWorkspaceEffect("reservation.office.preload-availability")),
  ]);

  return (
    <OfficeReservationForm
      checkoutSessionId={checkoutSessionId}
      existingCustomer={existingCustomerForm}
      seatCapacity={seatCapacity}
      initialAdvertisedPrices={initialAdvertisedPrices}
      initialAvailability={initialAvailability}
      initialReservation={initialReservation}
      initialValues={initialValues}
      locale={locale}
      replacementToken={replacementToken}
      submittedCode={submittedCode}
      today={today}
    />
  );
}
