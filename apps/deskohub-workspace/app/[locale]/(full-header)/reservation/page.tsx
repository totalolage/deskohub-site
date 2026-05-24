import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { ReservationPage } from "@/features/reservation";
import { workspaceSiteConstants } from "@/shared/utils";

type LocalizedWorkspaceReservationPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: LocalizedWorkspaceReservationPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.reservationMetadataTitle({}, { locale });
    const description = m.reservationMetadataDescription({}, { locale });
    const url = `https://${workspaceSiteConstants.brand.domain}/reservation`;

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            `https://${workspaceSiteConstants.brand.domain}/${itemLocale}/reservation`,
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

export default async function LocalizedWorkspaceReservationPage({
  params,
}: LocalizedWorkspaceReservationPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => (
    <ReservationPage locale={locale} />
  ));
}
