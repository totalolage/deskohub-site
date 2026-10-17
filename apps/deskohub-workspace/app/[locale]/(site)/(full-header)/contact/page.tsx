import type { Metadata } from "next";
import { ContactPage } from "@/features/contact";
import { getWorkspaceAlternates, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { workspaceSiteConstants } from "@/shared/utils";

export const instant = true;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const title = m.contactMetadataTitle({}, { locale });
    const description = m.contactMetadataDescription({}, { locale });
    const alternates = getWorkspaceAlternates(locale, "/contact");

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

export default async function LocalizedWorkspaceContactPage() {
  return runWithRequestLocale((locale) => <ContactPage locale={locale} />);
}
