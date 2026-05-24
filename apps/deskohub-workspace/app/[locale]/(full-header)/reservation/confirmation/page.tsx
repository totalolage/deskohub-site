import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  normalizeReservationConfirmationDetails,
  ReservationConfirmationPage,
  type ReservationConfirmationSearchParams,
} from "@/features/reservation";
import { workspaceSiteConstants } from "@/shared/utils";

type LocalizedWorkspaceReservationConfirmationPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<ReservationConfirmationSearchParams>;
};

export async function generateMetadata({
  params,
}: LocalizedWorkspaceReservationConfirmationPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.reservationConfirmationMetadataTitle({}, { locale });
    const description = m.reservationConfirmationMetadataDescription(
      {},
      { locale }
    );
    const url = `https://${workspaceSiteConstants.brand.domain}/reservation/confirmation`;

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            `https://${workspaceSiteConstants.brand.domain}/${itemLocale}/reservation/confirmation`,
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

export default async function LocalizedWorkspaceReservationConfirmationPage({
  params,
  searchParams,
}: LocalizedWorkspaceReservationConfirmationPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const details = normalizeReservationConfirmationDetails(await searchParams);

  return runWithRequestLocale(locale, () => (
    <ReservationConfirmationPage locale={locale} details={details} />
  ));
}
