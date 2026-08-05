import type { ReactNode } from "react";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { MinimalSiteHeader } from "@/shared/components/minimal-site-header";
import { PublicSiteFooter } from "@/shared/components/public-site-footer";
import { getSiteHeaderLanguageLabels } from "@/shared/components/site-header-config";

type MinimalHeaderLayoutProps = {
  children: ReactNode;
};

export default async function MinimalHeaderLayout({
  children,
}: MinimalHeaderLayoutProps) {
  const locale = await getRequestLocale();
  const languageLabels = getSiteHeaderLanguageLabels(locale);

  return (
    <>
      <MinimalSiteHeader
        currentLocale={locale}
        languageLabels={languageLabels}
      />
      {children}
      <PublicSiteFooter />
    </>
  );
}
