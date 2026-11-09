import { Effect, Schema } from "effect";
import { loadOfficeReservationSeatCapacity } from "@/features/office/backend/office-reservation-capacity.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getOfficeSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
import {
  getOfficeReservationDefaultValues,
  getOfficeReservationEndsOn,
  type OfficeReservationInput,
} from "@/features/reservation/office-reservation";
import { officeSelectionLink } from "@/features/reservation/office-selection-link";
import { getOfficePageOfferings } from "@/features/reservation/reservation-page-offerings";
import { officeReservationPath } from "@/features/reservation/routes";
import { getOfficeAvailabilityQuery } from "@/features/reservation/workspace-availability";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  OfficeReservationForm,
  OfficeReservationFormFallback,
} from "./office-reservation-form";

const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);

/** The office selection's start and end as plain dates. */
const getOfficeSelectionDates = (values: OfficeReservationInput) => ({
  startsOn: decodePlainDate(values.startsOn),
  endsOn: decodePlainDate(getOfficeReservationEndsOn(values)),
});

export const officeReservationPage = createReservationPage({
  fallback: (locale) => <OfficeReservationFormFallback locale={locale} />,
  kind: "office",
  pathname: officeReservationPath,
  /** The office seat capacity, loaded alongside the existing customer. */
  loadPageData: loadOfficeReservationSeatCapacity,
  // Office links never prefill a contact, so only an explicit `customer`
  // parameter chooses the mode.
  prefillsContact: false,
  // A selection the URL names after a Pay return replaces the signed one.
  restore: (reservation, searchParams, { pageData: seatCapacity, today }) => ({
    kind: "restored",
    values: officeSelectionLink.restore(
      getOfficeReservationDefaultValues(reservation),
      searchParams,
      { seatCapacity, today }
    ),
  }),
  read: (searchParams, { lastReservation, pageData: seatCapacity, today }) =>
    Effect.succeed(
      officeSelectionLink.read(searchParams, {
        lastReservation,
        seatCapacity,
        today,
      })
    ),
  preload: (
    values,
    { locale, pageData: seatCapacity, submittedCode, today }
  ) => ({
    advertisedPrices: getOfficeSeatAdvertisedPriceRequests({
      locale,
      seatCapacity,
      ...getOfficeSelectionDates(values),
      submittedCode,
    }),
    availability: [getOfficeAvailabilityQuery(today)],
  }),
  offerings: (
    values,
    advertisedPrices,
    { locale, pageData: seatCapacity, submittedCode }
  ) =>
    getOfficePageOfferings({
      advertisedPrices,
      locale,
      seatCapacity,
      selection: { ...getOfficeSelectionDates(values), seats: values.seats },
      submittedCode,
    }),
  renderForm: (form) => (
    <OfficeReservationForm
      checkoutCustomer={form.checkoutCustomer}
      checkoutSessionId={form.checkoutSessionId}
      initialAdvertisedPrices={form.initialAdvertisedPrices}
      initialAvailability={form.initialAvailability}
      initialValues={form.initialValues}
      locale={form.locale}
      replacementToken={form.replacementToken}
      seatCapacity={form.pageData}
      submittedCode={form.submittedCode}
      today={form.today}
    />
  ),
});
