import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LandingPage } from "@/features/landing-page/components/landing-page";
import { workspaceSiteConstants } from "@/shared/utils";

type LocalizedWorkspaceHomePageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: LocalizedWorkspaceHomePageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => {
    const title = m.landingMetadataTitle({}, { locale });
    const description = m.landingMetadataDescription({}, { locale });
    const url = `https://${workspaceSiteConstants.brand.domain}`;

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale: (typeof locales)[number]) => [
            itemLocale,
            `https://${workspaceSiteConstants.brand.domain}/${itemLocale}`,
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

export default async function LocalizedWorkspaceHomePage({
  params,
}: LocalizedWorkspaceHomePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => <LandingPage locale={locale} />);
}
