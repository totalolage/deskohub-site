import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutOrderPage } from "@/features/checkout/components/checkout-order-page";
import { coworkReservationPath } from "@/features/checkout/routes";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  ReservationForm,
  ReservationFormFallback,
} from "@/features/reservation/components/reservation-form";
import {
  reservationDefaultValues,
  tierRequiresMonitorOption,
} from "@/features/reservation/schemas/reservation";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

type LocalizedCoworkReservationPageProps = {
  params: Promise<{ locale: string }>;
};

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
}: LocalizedCoworkReservationPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const showMonitorOptionFallback = tierRequiresMonitorOption(
    reservationDefaultValues.entryTier
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
      <ReservationForm locale={locale} />
    </CheckoutOrderPage>
  ));
}
