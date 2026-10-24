import type { Metadata, ResolvingMetadata } from "next";
import { FaqPage } from "@/features/faq";
import { loadFaqOccupancyStats } from "@/features/faq/backend/faq-occupancy.server";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { createPublicPageMetadata } from "@/features/public-pages/page-metadata";

const pathname = "/faq";

export const instant = false;

export async function generateMetadata(
  _props: PageProps<"/[locale]/faq">,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createPublicPageMetadata(
      {
        locale,
        pathname: pathname,
        title: { absolute: m.faqMetadataTitle({}, { locale }) },
        description: m.faqMetadataDescription({}, { locale }),
      },
      parent
    )
  );
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
