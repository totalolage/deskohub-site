import { ContactPage } from "@/features/contact";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";

export const instant = true;

export const generateMetadata = publicPageMetadata("/contact");

export default async function LocalizedWorkspaceContactPage() {
  return runWithRequestLocale((locale) => <ContactPage locale={locale} />);
}
