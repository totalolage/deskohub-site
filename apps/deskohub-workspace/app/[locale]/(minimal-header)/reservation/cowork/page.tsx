import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PreloadedAdvertisedPrice } from "@/features/checkout/advertised-price";
import {
  openPayState,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { CheckoutOrderPage } from "@/features/checkout/components/checkout-order-page";
import { isLocale, type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  ReservationForm,
  ReservationFormFallback,
} from "@/features/reservation/components/reservation-form";
import {
  type CoworkTierAdvertisedPriceRequest,
  getCoworkTierAdvertisedPriceRequests,
} from "@/features/reservation/cowork-advertised-price";
import {
  coworkReservationDefaultValues,
  getCoworkTierRequiresMonitorOption,
} from "@/features/reservation/cowork-reservation";
import {
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import { coworkReservationPath } from "@/features/reservation/routes";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  getSearchParam,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

type LocalizedCoworkReservationPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const getOrderPayState = Effect.fn("checkoutOrder.getPayState")(function* (
  token: string | undefined,
  locale: Locale
) {
  if (!token) return undefined;

  const state = yield* openPayState(token).pipe(Effect.option);
  return Option.getOrUndefined(
    Option.filter(state, (payState) => payState.locale === locale)
  );
});

const loadInitialAdvertisedPrices = Effect.fn(
  "checkoutOrder.loadInitialAdvertisedPrices"
)(function* (requests: ReadonlyArray<CoworkTierAdvertisedPriceRequest>) {
  const results = yield* Effect.all(
    requests.map(({ request, tier }) =>
      buildAdvertisedPrice(request).pipe(
        Effect.tapError(() =>
          Effect.logError("Initial advertised price load failed", {
            productIdentity: { kind: "cowork", tier },
          })
        ),
        Effect.option,
        Effect.map(
          Option.map(
            (advertisedPrice): PreloadedAdvertisedPrice => ({
              request,
              advertisedPrice,
            })
          )
        )
      )
    ),
    { concurrency: "unbounded" }
  );

  return results.filter(Option.isSome).map(({ value }) => value);
});

export async function generateMetadata({
  params,
}: LocalizedCoworkReservationPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.checkoutOrderMetadataTitle({}, { locale });
    const description = m.checkoutOrderMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(
      locale,
      coworkReservationPath
    );

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(
              itemLocale,
              coworkReservationPath
            ),
          ])
        ),
      },
      openGraph: {
        title,
        description,
        url,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
    } satisfies Metadata;
  });
}

export default async function LocalizedCoworkReservationPage({
  params,
  searchParams,
}: LocalizedCoworkReservationPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const resolvedSearchParams = await searchParams;
  const payState = await getOrderPayState(
    getSearchParam(resolvedSearchParams, payStateTokenQueryParam),
    locale
  ).pipe(runWorkspaceEffect("reservation.cowork.load-state"));
  const initialReservation =
    payState?.reservation.kind === "cowork" ? payState.reservation : undefined;
  const initialValues = initialReservation
    ? getReservationDefaultValuesFromPayState(initialReservation)
    : getReservationDefaultValuesFromSearchParams(resolvedSearchParams);
  const initialAdvertisedPriceRequests = initialValues.date
    ? getCoworkTierAdvertisedPriceRequests({
        coffee: Boolean(initialValues.coffee),
        date: initialValues.date,
        locale,
      })
    : [];
  const initialAdvertisedPrices = await runWithRequestLocale(locale, () =>
    loadInitialAdvertisedPrices(initialAdvertisedPriceRequests).pipe(
      Effect.provide(CheckoutPricingServiceLiveWithDependencies),
      Effect.scoped,
      runWorkspaceEffect("reservation.cowork.load-advertised-prices")
    )
  );
  const showMonitorOptionFallback = getCoworkTierRequiresMonitorOption(
    initialReservation?.entryTier ?? coworkReservationDefaultValues.entryTier
  );

  return runWithRequestLocale(locale, () => (
    <CheckoutOrderPage
      fallback={
        <ReservationFormFallback
          locale={locale}
          showMonitorOption={showMonitorOptionFallback}
        />
      }
      locale={locale}
    >
      <ReservationForm
        initialAdvertisedPrices={initialAdvertisedPrices}
        initialReservation={initialReservation}
        locale={locale}
        checkoutSessionId={payState?.checkoutSessionId}
      />
    </CheckoutOrderPage>
  ));
}
