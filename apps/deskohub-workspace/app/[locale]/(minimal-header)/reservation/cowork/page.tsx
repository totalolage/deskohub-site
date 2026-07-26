import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  openPayState,
  payStateTokenQueryParam,
} from "@/features/checkout/backend/checkout";
import { CheckoutOrderPage } from "@/features/checkout/components/checkout-order-page";
import { isLocale, type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  ReservationForm,
  ReservationFormFallback,
} from "@/features/reservation/components/reservation-form";
import {
  coworkReservationDefaultValues,
  getCoworkTierRequiresMonitorOption,
} from "@/features/reservation/cowork-reservation";
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
  const payState = await getOrderPayState(
    getSearchParam(await searchParams, payStateTokenQueryParam),
    locale
  ).pipe(runWorkspaceEffect("reservation.cowork.load-state"));
  const initialReservation =
    payState?.reservation.kind === "cowork" ? payState.reservation : undefined;
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
        initialReservation={initialReservation}
        locale={locale}
        checkoutSessionId={payState?.checkoutSessionId}
      />
    </CheckoutOrderPage>
  ));
}
