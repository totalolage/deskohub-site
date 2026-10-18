import type { Metadata } from "next";
import { getWorkspaceAlternates, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LandingPage } from "@/features/landing-page/components/landing-page";
import { workspaceSiteConstants } from "@/shared/utils";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const title = m.landingMetadataTitle({}, { locale });
    const description = m.landingMetadataDescription({}, { locale });
    const alternates = getWorkspaceAlternates(locale);

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

export default async function LocalizedWorkspaceHomePage() {
  return runWithRequestLocale((locale) => <LandingPage locale={locale} />);
}
