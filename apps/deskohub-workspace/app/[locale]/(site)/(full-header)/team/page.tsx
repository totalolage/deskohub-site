import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";
import { TeamPage } from "@/features/team";

export const instant = false;

export const generateMetadata = publicPageMetadata("/team");

export default async function LocalizedTeamPage() {
  return runWithRequestLocale((locale) => <TeamPage locale={locale} />);
}
