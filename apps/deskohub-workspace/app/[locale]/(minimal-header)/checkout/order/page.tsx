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
  getSearchParam,
  getWorkspaceLocalizedCanonicalUrl,
  type SearchParamsRecord,
  workspaceSiteConstants,
} from "@/shared/utils";

type LocalizedCheckoutOrderPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

const getOrderPayState = (token: string | undefined, locale: Locale) => {
  if (!token) return undefined;

  try {
    const state = openPayState(token);
    return state.locale === locale ? state : undefined;
  } catch {
    return undefined;
  }
};

export async function generateMetadata({
  params,
}: LocalizedCheckoutOrderPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.checkoutOrderMetadataTitle({}, { locale });
    const description = m.checkoutOrderMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(locale, "/checkout/order");

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(itemLocale, "/checkout/order"),
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

export default async function LocalizedCheckoutOrderPage({
  params,
  searchParams,
}: LocalizedCheckoutOrderPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const payState = getOrderPayState(
    getSearchParam(await searchParams, payStateTokenQueryParam),
    locale
  );

  return runWithRequestLocale(locale, () => (
    <CheckoutOrderPage
      initialReservation={payState?.reservation}
      locale={locale}
      reservationIntentId={payState?.reservationIntentId}
    />
  ));
}
