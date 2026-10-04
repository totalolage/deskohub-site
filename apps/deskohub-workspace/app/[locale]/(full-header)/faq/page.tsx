import type { Metadata } from "next";
import { FaqPage } from "@/features/faq";
import { loadFaqOccupancyStats } from "@/features/faq/backend/faq-occupancy.server";
import { locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

const pathname = "/faq";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const title = m.faqMetadataTitle({}, { locale });
    const description = m.faqMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(locale, pathname);

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(itemLocale, pathname),
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

export default async function LocalizedFaqPage() {
  const occupancy = await loadFaqOccupancyStats();

  return runWithRequestLocale((locale) => (
    <FaqPage
      averageReservationsPerDay={occupancy.averageReservationsPerDay}
      coworkSeatCapacity={occupancy.coworkSeatCapacity}
      locale={locale}
    />
  ));
}
