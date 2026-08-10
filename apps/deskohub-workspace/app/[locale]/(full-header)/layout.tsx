import { type ReactNode, Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { PublicSiteFooter } from "@/shared/components/public-site-footer";
import { SiteHeader } from "@/shared/components/site-header";
import {
  getSiteHeaderConfig,
  getSiteHeaderShellConfig,
} from "@/shared/components/site-header-config";

type FullHeaderLayoutProps = {
  children: ReactNode;
};

export default async function FullHeaderLayout({
  children,
}: FullHeaderLayoutProps) {
  const locale = await getRequestLocale();

  return (
    <>
      <Suspense
        fallback={
          <SiteHeader
            currentLocale={locale}
            {...getSiteHeaderShellConfig(locale)}
          />
        }
      >
        <SiteHeaderWithFeatureFlags locale={locale} />
      </Suspense>
      {children}
      <PublicSiteFooter />
    </>
  );
}

async function SiteHeaderWithFeatureFlags({
  locale,
}: {
  readonly locale: Locale;
}) {
  const siteHeaderConfig = await getSiteHeaderConfig(locale);

  return <SiteHeader currentLocale={locale} {...siteHeaderConfig} />;
}
