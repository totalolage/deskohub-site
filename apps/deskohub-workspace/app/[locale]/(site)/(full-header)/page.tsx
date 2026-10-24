import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LandingPage } from "@/features/landing-page/components/landing-page";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";

export const instant = false;

export const generateMetadata = publicPageMetadata("/");

export default async function LocalizedWorkspaceHomePage() {
  return runWithRequestLocale((locale) => <LandingPage locale={locale} />);
}
