import type { Metadata } from "next";
import { getWorkspaceAlternates, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { TeamPage } from "@/features/team";
import { workspaceSiteConstants } from "@/shared/utils";

const pathname = "/team";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const title = m.teamMetadataTitle({}, { locale });
    const description = m.teamMetadataDescription({}, { locale });
    const alternates = getWorkspaceAlternates(locale, pathname);

    return {
      title,
      description,
      alternates,
      openGraph: {
        title,
        description,
        url: alternates.canonical,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
    } satisfies Metadata;
  });
}

export default async function LocalizedTeamPage() {
  return runWithRequestLocale((locale) => <TeamPage locale={locale} />);
}
