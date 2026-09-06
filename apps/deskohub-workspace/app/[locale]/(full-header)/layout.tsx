import type { ReactNode } from "react";
import { m } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { PageNavigationBoundary } from "@/shared/components/page-navigation-boundary";
import { PublicSiteFooter } from "@/shared/components/public-site-footer";
import { SiteHeader } from "@/shared/components/site-header";
import { getSiteHeaderConfig } from "@/shared/components/site-header-config";
import { SkipLink } from "@/shared/components/skip-link";

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
      <SkipLink label={m.skipToMainContent({}, { locale })} />
      <SiteHeader currentLocale={locale} {...siteHeaderConfig} />
      <div id="main-content" tabIndex={-1}>
        <PageNavigationBoundary>{children}</PageNavigationBoundary>
      </div>
      <PublicSiteFooter />
    </>
  );
}
