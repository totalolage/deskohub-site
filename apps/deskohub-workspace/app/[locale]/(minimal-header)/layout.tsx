import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { MinimalSiteHeader } from "@/shared/components/minimal-site-header";
import { PublicSiteFooter } from "@/shared/components/public-site-footer";
import { getSiteHeaderLanguageLabels } from "@/shared/components/site-header-config";

type MinimalHeaderLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: Locale }>;
};

export default async function MinimalHeaderLayout({
  children,
  params,
}: MinimalHeaderLayoutProps) {
  const { locale } = await params;
  const languageLabels = getSiteHeaderLanguageLabels(locale);

  return (
    <>
      <MinimalSiteHeader
        currentLocale={locale}
        languageLabels={languageLabels}
      />
      {children}
      <PublicSiteFooter locale={locale} />
    </>
  );
}
