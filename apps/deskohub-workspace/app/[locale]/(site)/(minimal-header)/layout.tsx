import type { ReactNode } from "react";
import { m } from "@/features/i18n";
import { getLanguageLabels } from "@/features/i18n/language-labels";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { MinimalSiteHeader } from "@/shared/components/minimal-site-header";
import { PublicSiteFooter } from "@/shared/components/public-site-footer";
import {
  createLocalePreferenceSaving,
  getSiteHeaderAccessibilityLabels,
} from "@/shared/components/site-header-config";
import { SkipLink } from "@/shared/components/skip-link";

type MinimalHeaderLayoutProps = {
  children: ReactNode;
};

export default async function MinimalHeaderLayout({
  children,
}: MinimalHeaderLayoutProps) {
  const locale = await getRequestLocale();
  const languageLabels = getLanguageLabels(locale);
  const { languageSwitcherLabel } = getSiteHeaderAccessibilityLabels(locale);
  const localePreference = createLocalePreferenceSaving();

  return (
    <>
      <SkipLink label={m.skipToMainContent({}, { locale })} />
      <MinimalSiteHeader
        currentLocale={locale}
        languageLabels={languageLabels}
        languageSwitcherLabel={languageSwitcherLabel}
        localePreference={localePreference}
      />
      <div id="main-content" tabIndex={-1}>
        {children}
      </div>
      <PublicSiteFooter />
    </>
  );
}
