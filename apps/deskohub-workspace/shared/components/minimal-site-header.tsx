import Link from "next/link";
import type { LocalePreferenceSaving } from "@/features/account/switch-locale";
import type { Locale } from "@/features/i18n";
import { LanguageMenu } from "@/shared/components/locale-switcher";
import { SiteHeaderLogo } from "@/shared/components/site-header-logo";

type MinimalSiteHeaderProps = {
  currentLocale: Locale;
  languageMenuTriggerLabel: string;
  localePreference?: LocalePreferenceSaving;
};

export function MinimalSiteHeader({
  currentLocale,
  languageMenuTriggerLabel,
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

        <LanguageMenu
          locale={currentLocale}
          triggerLabel={languageMenuTriggerLabel}
          tone="inverse"
          localePreference={localePreference}
        />
      </div>
    </header>
  );
}
