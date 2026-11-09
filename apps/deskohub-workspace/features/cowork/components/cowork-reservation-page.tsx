import { Effect } from "effect";
import { isWorkspaceCoworkCurrentProductTier } from "@/features/checkout/product-catalog";
import { type Locale, m } from "@/features/i18n";
import { isRememberedCoworkOfferAvailable } from "@/features/reservation/backend/reservation-existing-customer.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getCoworkDateAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import {
  type CoworkReservationInput,
  getCoworkReservationDefaultValues,
} from "@/features/reservation/cowork-reservation";
import { coworkSelectionLink } from "@/features/reservation/cowork-selection-link";
import { getCoworkPageOfferings } from "@/features/reservation/reservation-page-offerings";
import {
  coworkReservationPath,
  getCoworkReservationPath,
} from "@/features/reservation/routes";
import { getCoworkAvailabilityQueries } from "@/features/reservation/workspace-availability";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  CoworkReservationForm,
  CoworkReservationFormFallback,
} from "./cowork-reservation-form";

const withWorkspaceDate = (values: CoworkReservationInput, today: string) =>
  values.date ? values : { ...values, date: today };

export const coworkReservationPage = createReservationPage({
  breadcrumbs: (locale) => [
    { pathname: "/coworking", name: m.coworkingBreadcrumb({}, { locale }) },
    {
      pathname: coworkReservationPath,
      name: m.reservationCoworkBreadcrumb({}, { locale }),
    },
  ],
  fallback: (locale) => <CoworkReservationFormFallback locale={locale} />,
  kind: "cowork",
  pathname: coworkReservationPath,
  prefillsContact: true,
  // A historical tier can't be booked again, so its customer starts over.
  restore: (reservation, searchParams, { locale, today }) =>
    isWorkspaceCoworkCurrentProductTier(reservation.entryTier)
      ? {
          kind: "restored",
          values: withWorkspaceDate(
            coworkSelectionLink.restore(
              getCoworkReservationDefaultValues(reservation),
              searchParams
            ),
            today
          ),
        }
      : { kind: "replaced", content: <CoworkOfferReplaced locale={locale} /> },
  /**
   * Cowork form values from a link, filled from the customer's last cowork
   * offer only while that offer is still bookable on the form's date.
   */
  read: Effect.fn("coworkReservationPage.read")(function* (
    searchParams,
    { lastReservation, today }
  ) {
    const queryValues = withWorkspaceDate(
      coworkSelectionLink.read(searchParams),
      today
    );
    if (!lastReservation) return queryValues;

    const rememberedValues = withWorkspaceDate(
      coworkSelectionLink.read(searchParams, { lastReservation }),
      today
    );
    if (
      rememberedValues.entryTier === queryValues.entryTier &&
      rememberedValues.coffee === queryValues.coffee &&
      rememberedValues.monitorOption === queryValues.monitorOption
    ) {
      return queryValues;
    }

    return (yield* isRememberedCoworkOfferAvailable(rememberedValues))
      ? rememberedValues
      : queryValues;
  }),
  // Every price and the initial availability render with the content, so no
  // option streams in later and resizes the form.
  preload: (values, { locale, submittedCode, today }) => ({
    advertisedPrices: getCoworkDateAdvertisedPriceRequests({
      date: values.date,
      locale,
      submittedCode,
    }),
    availability: Object.values(
      getCoworkAvailabilityQueries({ ...values, today })
    ),
  }),
  offerings: (values, advertisedPrices, { locale, submittedCode }) =>
    getCoworkPageOfferings({
      advertisedPrices,
      coffee: Boolean(values.coffee),
      date: values.date,
      locale,
      submittedCode,
    }),
  renderForm: (form) => (
    <CoworkReservationForm
      checkoutCustomer={form.checkoutCustomer}
      checkoutSessionId={form.checkoutSessionId}
      initialAdvertisedPrices={form.initialAdvertisedPrices}
      initialAvailability={form.initialAvailability}
      initialValues={form.initialValues}
      locale={form.locale}
      replacementToken={form.replacementToken}
      submittedCode={form.submittedCode}
      today={form.today}
    />
  ),
});

export function CoworkOfferReplaced({ locale }: { readonly locale: Locale }) {
  return (
    <Card className="relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm">
      <CardHeader className="space-y-3 pb-6">
        <CardTitle as="h2" className="text-3xl sm:text-[2.35rem]">
          {m.reservationValidationCoworkOfferReplaced({}, { locale })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Button asChild size="xl" caps fullWidth>
          <a href={getCoworkReservationPath(locale)}>
            {m.checkoutPayRestartButton({}, { locale })}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
