import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { PricingPage } from "@/features/pricing";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";

export const instant = true;

export const generateMetadata = publicPageMetadata("/pricing");

export default async function LocalizedWorkspacePricingPage() {
  return runWithRequestLocale((locale) => <PricingPage locale={locale} />);
}
