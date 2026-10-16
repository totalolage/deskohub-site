import type { Metadata } from "next";
import { ContactPage } from "@/features/contact";
import { locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

export const instant = true;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const title = m.contactMetadataTitle({}, { locale });
    const description = m.contactMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(locale, "/contact");

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(itemLocale, "/contact"),
          ])
        ),
      },
      openGraph: {
        title,
        description,
        url,
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
