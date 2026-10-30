import { FaqPage } from "@/features/faq";
import { loadFaqOccupancyStats } from "@/features/faq/backend/faq-occupancy.server";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { isOfficePageEnabled } from "@/features/office/backend/office-reservation-feature-flag.server";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";

export const instant = false;

export const generateMetadata = publicPageMetadata("/faq");

export default async function LocalizedFaqPage() {
  const [occupancy, officePageEnabled] = await Promise.all([
    loadFaqOccupancyStats(),
    isOfficePageEnabled(),
  ]);

  return runWithRequestLocale((locale) => (
    <FaqPage
      locale={locale}
      occupancy={occupancy}
      officesOffered={officePageEnabled}
    />
  ));
}
