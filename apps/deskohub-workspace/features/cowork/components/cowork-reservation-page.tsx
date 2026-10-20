import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import { isWorkspaceCoworkCurrentProductTier } from "@/features/checkout/product-catalog";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import { preloadPageAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { isRememberedCoworkOfferAvailable } from "@/features/reservation/backend/reservation-existing-customer.server";
import { preloadPageAvailability } from "@/features/reservation/backend/workspace-availability-loader";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { ReservationOfferingsStructuredData } from "@/features/reservation/components/reservation-offerings-structured-data";
import { getCoworkDateAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import type {
  CoworkReservationInput,
  NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import {
  getCoworkRestoredReservationValues,
  getReservationDefaultValuesFromSearchParams,
} from "@/features/reservation/cowork-reservation-checkout-query";
import type { ReservationCheckoutContact } from "@/features/reservation/reservation-checkout-contact";
import { getReservationCustomerQueryMode } from "@/features/reservation/reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  type CustomerLastReservationForKind,
  getCheckoutAccountLastReservation,
  getReservationCheckoutCustomerForm,
  type ReservationCheckoutAccount,
} from "@/features/reservation/reservation-existing-customer";
import { getCoworkPageOfferings } from "@/features/reservation/reservation-page-offerings";
import {
  coworkReservationPath,
  getCoworkReservationPath,
} from "@/features/reservation/routes";
import { getCoworkAvailabilityQueries } from "@/features/reservation/workspace-availability";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
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

const withWorkspaceDate = (values: CoworkReservationInput, today: string) =>
  values.date ? values : { ...values, date: today };

/**
 * Cowork form values from a link, filled from the customer's last cowork
 * offer only while that offer is still bookable on the form's date.
 */
const getCoworkQueryValues = async (
  searchParams: SearchParamsRecord,
  lastReservation: CustomerLastReservationForKind<"cowork"> | undefined,
  today: string
) => {
  const queryValues = withWorkspaceDate(
    getReservationDefaultValuesFromSearchParams(searchParams),
    today
  );
  if (!lastReservation) return queryValues;

  const rememberedValues = withWorkspaceDate(
    getReservationDefaultValuesFromSearchParams(searchParams, lastReservation),
    today
  );
  if (
    rememberedValues.entryTier === queryValues.entryTier &&
    rememberedValues.coffee === queryValues.coffee &&
    rememberedValues.monitorOption === queryValues.monitorOption
  ) {
    return queryValues;
  }

  return (await isRememberedCoworkOfferAvailable(rememberedValues))
    ? rememberedValues
    : queryValues;
};

export async function renderCoworkReservationContent({
  checkoutSessionId,
  checkoutAccount,
  checkoutContact,
  initialReservation,
  locale,
  replacementToken,
  searchParams,
  submittedCode,
}: {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly checkoutAccount: ReservationCheckoutAccount<"cowork">;
  readonly checkoutContact?: ReservationCheckoutContact;
  readonly initialReservation?: NormalizedCoworkReservationOrder;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly searchParams: SearchParamsRecord;
  readonly submittedCode?: CanonicalPromotionCode;
}) {
  if (
    initialReservation &&
    !isWorkspaceCoworkCurrentProductTier(initialReservation.entryTier)
  ) {
    return <CoworkOfferReplaced locale={locale} />;
  }

  const today = getCurrentWorkspaceDate().toString();
  const restoredOrQueryValues = initialReservation
    ? withWorkspaceDate(
        getCoworkRestoredReservationValues(initialReservation, searchParams),
        today
      )
    : await getCoworkQueryValues(
        searchParams,
        getCheckoutAccountLastReservation(checkoutAccount),
        today
      );
  const { checkoutCustomer, initialValues } =
    getReservationCheckoutCustomerForm({
      account: checkoutAccount,
      checkoutContact,
      queryMode: getReservationCustomerQueryMode(searchParams),
      restored: Boolean(initialReservation),
      values: restoredOrQueryValues,
    });
  // Every price and the initial availability render with the content, so no
  // option streams in later and resizes the form.
  const [initialAdvertisedPrices, initialAvailability] = await Promise.all([
    preloadPageAdvertisedPrices(
      getCoworkDateAdvertisedPriceRequests({
        date: initialValues.date,
        locale,
        submittedCode,
      })
    ).pipe(runWorkspaceEffect("reservation.cowork.load-advertised-price")),
    preloadPageAvailability({
      queries: Object.values(
        getCoworkAvailabilityQueries({ ...initialValues, today })
      ),
      replacementToken,
    }).pipe(runWorkspaceEffect("reservation.cowork.preload-availability")),
  ]);

  return (
    <>
      <ReservationOfferingsStructuredData
        locale={locale}
        offerings={getCoworkPageOfferings({
          advertisedPrices: initialAdvertisedPrices,
          coffee: Boolean(initialValues.coffee),
          date: initialValues.date,
          locale,
          submittedCode,
        })}
        pathname={coworkReservationPath}
      />
      <CoworkReservationForm
        checkoutSessionId={checkoutSessionId}
        checkoutCustomer={checkoutCustomer}
        initialAdvertisedPrices={initialAdvertisedPrices}
        initialAvailability={initialAvailability}
        initialReservation={initialReservation}
        initialValues={initialValues}
        locale={locale}
        replacementToken={replacementToken}
        submittedCode={submittedCode}
        today={today}
      />
    </>
  );
}
