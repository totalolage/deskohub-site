import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LandingPage } from "@/features/landing-page/components/landing-page";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";
import { StructuredData } from "@/shared/components/structured-data";
import { getWebSiteStructuredData } from "@/shared/utils/structured-data";

export const instant = false;

export const generateMetadata = publicPageMetadata("/");

export default async function LocalizedWorkspaceHomePage() {
  return runWithRequestLocale((locale) => (
    <>
      <StructuredData data={getWebSiteStructuredData()} />
      <LandingPage locale={locale} />
    </>
  ));
}
