import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactPage } from "@/features/contact";
import { isWorkspaceLocale, m, workspaceLocales } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { workspaceSiteConstants } from "@/shared/utils";

type LocalizedWorkspaceContactPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: LocalizedWorkspaceContactPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isWorkspaceLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.contactMetadataTitle({}, { locale });
    const description = m.contactMetadataDescription({}, { locale });
    const url = `https://${workspaceSiteConstants.brand.domain}/contact`;

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          workspaceLocales.map((itemLocale) => [
            itemLocale,
            `https://${workspaceSiteConstants.brand.domain}/${itemLocale}/contact`,
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
  if (!isWorkspaceLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => <ContactPage locale={locale} />);
}
