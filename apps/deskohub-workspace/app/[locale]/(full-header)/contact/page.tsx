import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactPage } from "@/features/contact";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

type LocalizedWorkspaceContactPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: LocalizedWorkspaceContactPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
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

export default async function LocalizedWorkspaceContactPage({
  params,
}: LocalizedWorkspaceContactPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => <ContactPage locale={locale} />);
}
