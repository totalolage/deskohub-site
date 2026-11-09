import type { ReactNode } from "react";
import { createLocalePreferenceSaving } from "@/features/account/server/locale-preference-saving.server";
import { m } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { MinimalSiteHeader } from "@/shared/components/minimal-site-header";
import { PublicSiteFooter } from "@/shared/components/public-site-footer";
import { getSiteHeaderAccessibilityLabels } from "@/shared/components/site-header-config";
import { SkipLink } from "@/shared/components/skip-link";

type MinimalHeaderLayoutProps = {
  children: ReactNode;
};

export default async function MinimalHeaderLayout({
  children,
}: MinimalHeaderLayoutProps) {
  const locale = await getRequestLocale();
  const { languageMenuTriggerLabel } = getSiteHeaderAccessibilityLabels(locale);
  const localePreference = createLocalePreferenceSaving();

  return (
    <>
      <SkipLink label={m.skipToMainContent({}, { locale })} />
      <MinimalSiteHeader
        currentLocale={locale}
        languageMenuTriggerLabel={languageMenuTriggerLabel}
        localePreference={localePreference}
      />
      <div id="main-content" tabIndex={-1}>
        {children}
      </div>
      <PublicSiteFooter localePreference={localePreference} />
    </>
  );
}
