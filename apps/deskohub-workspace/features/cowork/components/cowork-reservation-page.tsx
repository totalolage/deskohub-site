import { Effect } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import { isWorkspaceCoworkCurrentProductTier } from "@/features/checkout/product-catalog";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import { loadAdvertisedPrices } from "@/features/reservation/backend/advertised-prices.server";
import { isRememberedCoworkOfferAvailable } from "@/features/reservation/backend/reservation-existing-customer.server";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { getCoworkTierAdvertisedPriceRequests } from "@/features/reservation/cowork-advertised-price";
import type {
  CoworkReservationInput,
  NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import {
  getReservationCustomerQueryMode,
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  type CustomerLastReservationForKind,
  getReservationExistingCustomerForm,
  type ReservationExistingCustomer,
} from "@/features/reservation/reservation-existing-customer";
import {
  coworkReservationPath,
  getCoworkReservationPath,
} from "@/features/reservation/routes";
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
        <Button
          asChild
          className="h-13 w-full rounded-full text-sm uppercase tracking-[0.18em]"
        >
          <a href={getCoworkReservationPath(locale)}>
            {m.checkoutPayRestartButton({}, { locale })}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

const withWorkspaceDate = (values: CoworkReservationInput) =>
  values.date
    ? values
    : { ...values, date: getCurrentWorkspaceDate().toString() };

/**
 * Cowork form values from a link, filled from the customer's last cowork
 * offer only while that offer is still bookable on the form's date.
 */
const getCoworkQueryValues = async (
  searchParams: SearchParamsRecord,
  lastReservation: CustomerLastReservationForKind<"cowork"> | undefined
) => {
  const queryValues = withWorkspaceDate(
    getReservationDefaultValuesFromSearchParams(searchParams)
  );
  if (!lastReservation) return queryValues;

  const rememberedValues = withWorkspaceDate(
    getReservationDefaultValuesFromSearchParams(searchParams, lastReservation)
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
  existingCustomer,
  initialReservation,
  locale,
  replacementToken,
  searchParams,
  submittedCode,
}: {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly existingCustomer?: ReservationExistingCustomer<"cowork">;
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

  const restoredOrQueryValues = initialReservation
    ? withWorkspaceDate(
        getReservationDefaultValuesFromPayState(initialReservation)
      )
    : await getCoworkQueryValues(
        searchParams,
        existingCustomer?.lastReservation
      );
  const { existingCustomer: existingCustomerForm, initialValues } =
    existingCustomer
      ? getReservationExistingCustomerForm({
          contact: existingCustomer.contact,
          queryMode: getReservationCustomerQueryMode(searchParams),
          restored: Boolean(initialReservation),
          values: restoredOrQueryValues,
        })
      : { existingCustomer: undefined, initialValues: restoredOrQueryValues };
  const initialAdvertisedPrices = await loadAdvertisedPrices(
    getCoworkTierAdvertisedPriceRequests({
      date: initialValues.date,
      locale,
      offers: [
        { entryTier: "open-space", coffee: initialValues.coffee },
        {
          entryTier: "reserved-desk",
          coffee: true,
          ...(initialValues.monitorOption && {
            monitorOption: initialValues.monitorOption,
          }),
        },
      ],
      submittedCode,
    }).filter(
      ({ reservation }) =>
        reservation.details.entryTier === initialValues.entryTier &&
        (reservation.details.entryTier !== "reserved-desk" ||
          reservation.details.workstation ===
            (initialValues.monitorOption !== undefined))
    )
  ).pipe(
    Effect.provide(CheckoutPricingService.Live),
    Effect.scoped,
    runWorkspaceEffect("reservation.cowork.load-advertised-price")
  );

  return (
    <CoworkReservationForm
      checkoutSessionId={checkoutSessionId}
      existingCustomer={existingCustomerForm}
      initialAdvertisedPrices={initialAdvertisedPrices}
      initialReservation={initialReservation}
      initialValues={initialValues}
      locale={locale}
      replacementToken={replacementToken}
      submittedCode={submittedCode}
    />
  );
}
