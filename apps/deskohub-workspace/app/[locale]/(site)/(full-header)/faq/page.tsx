import type { Metadata } from "next";
import { FaqPage } from "@/features/faq";
import { loadFaqOccupancyStats } from "@/features/faq/backend/faq-occupancy.server";
import { getWorkspaceAlternates, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { workspaceSiteConstants } from "@/shared/utils";

const pathname = "/faq";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const title = m.faqMetadataTitle({}, { locale });
    const description = m.faqMetadataDescription({}, { locale });
    const alternates = getWorkspaceAlternates(locale, pathname);

    return {
      title,
      description,
      alternates,
      openGraph: {
        title,
        description,
        url: alternates.canonical,
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
