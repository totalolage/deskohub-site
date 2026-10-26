import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LegalPage } from "@/features/legal";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";

export const generateMetadata = publicPageMetadata("/operating-rules");

export default async function OperatingRulesPage() {
  return runWithRequestLocale((locale) => (
    <LegalPage locale={locale} documentKey="operating-rules" />
  ));
}
