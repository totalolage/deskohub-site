import type { ReactNode } from "react";
import type { WorkspaceLocale } from "@/features/i18n";
import { SiteHeader } from "@/shared/components/site-header";
import { getSiteHeaderConfig } from "@/shared/components/site-header-config";

type FullHeaderLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: WorkspaceLocale }>;
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
    </>
  );
}
