import Link from "next/link";
import { Suspense } from "react";
import type { LocalePreferenceSaving } from "@/features/account/switch-locale";
import type { Locale } from "@/features/i18n";
import {
  LocaleSwitcherLabels,
  LocaleSwitcherLinks,
} from "@/shared/components/locale-switcher-links";
import { SiteHeaderLogo } from "@/shared/components/site-header-logo";

type MinimalSiteHeaderProps = {
  currentLocale: Locale;
  languageLabels: Record<Locale, string>;
  languageSwitcherLabel: string;
  localePreference?: LocalePreferenceSaving;
};

export function MinimalSiteHeader({
  currentLocale,
  languageLabels,
  languageSwitcherLabel,
  localePreference,
}: MinimalSiteHeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 h-[var(--site-header-height)] border-b border-white/10 bg-navy-blue/92 text-white backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href={`/${currentLocale}`}
          prefetch={false}
          aria-label="Deskohub Workspace"
          className="shrink-0"
        >
          <SiteHeaderLogo />
        </Link>

        <nav
          aria-label={languageSwitcherLabel}
          data-locale-switcher
          className="rounded-full border border-white/12 bg-white/6 px-6 py-2 text-center text-xs uppercase tracking-[0.14em] text-white/72"
        >
          <Suspense
            fallback={
              <LocaleSwitcherLabels
                currentLocale={currentLocale}
                languageLabels={languageLabels}
              />
            }
          >
            <LocaleSwitcherLinks
              currentLocale={currentLocale}
              languageLabels={languageLabels}
              localePreference={localePreference}
            />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
