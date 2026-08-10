import type { ReactNode } from "react";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { PublicSiteFooter } from "@/shared/components/public-site-footer";
import { SiteHeader } from "@/shared/components/site-header";
import { getSiteHeaderConfig } from "@/shared/components/site-header-config";

type FullHeaderLayoutProps = {
  children: ReactNode;
};

export const instant = false;

export default async function FullHeaderLayout({
  children,
}: FullHeaderLayoutProps) {
  const locale = await getRequestLocale();
  const siteHeaderConfig = await getSiteHeaderConfig(locale);

  return (
    <>
      <SiteHeader currentLocale={locale} {...siteHeaderConfig} />
      {children}
      <PublicSiteFooter />
    </>
  );
}
