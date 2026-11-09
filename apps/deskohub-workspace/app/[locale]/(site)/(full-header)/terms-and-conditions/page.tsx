import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LegalPage } from "@/features/legal";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";

export const generateMetadata = publicPageMetadata("/terms-and-conditions");

export default async function TermsAndConditionsPage() {
  return runWithRequestLocale((locale) => (
    <LegalPage locale={locale} documentKey="terms-and-conditions" />
  ));
}
