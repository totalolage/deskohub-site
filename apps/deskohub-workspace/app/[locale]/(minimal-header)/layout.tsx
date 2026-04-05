import type { ReactNode } from "react";
import type { WorkspaceLocale } from "@/features/i18n";
import { MinimalSiteHeader } from "@/shared/components/minimal-site-header";
import { getSiteHeaderConfig } from "@/shared/components/site-header-config";

type MinimalHeaderLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: WorkspaceLocale }>;
};

export default async function MinimalHeaderLayout({
  children,
  params,
}: MinimalHeaderLayoutProps) {
  const { locale } = await params;
  const { languageLabels } = getSiteHeaderConfig(locale);

  return (
    <>
      <MinimalSiteHeader
        currentLocale={locale}
        languageLabels={languageLabels}
      />
      {children}
    </>
  );
}
