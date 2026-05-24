import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { PublicSiteFooter } from "@/shared/components/public-site-footer";
import { SiteHeader } from "@/shared/components/site-header";
import { getSiteHeaderConfig } from "@/shared/components/site-header-config";

type FullHeaderLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: Locale }>;
};

export default async function FullHeaderLayout({
  children,
  params,
}: FullHeaderLayoutProps) {
  const { locale } = await params;
  const siteHeaderConfig = getSiteHeaderConfig(locale);

  return (
    <>
      <SiteHeader currentLocale={locale} {...siteHeaderConfig} />
      {children}
      <PublicSiteFooter locale={locale} />
    </>
  );
}
