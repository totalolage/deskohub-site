import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LegalPage } from "@/features/legal";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";

export const generateMetadata = publicPageMetadata("/privacy-policy");

export default async function PrivacyPolicyPage() {
  return runWithRequestLocale((locale) => (
    <LegalPage locale={locale} documentKey="privacy-policy" />
  ));
}
