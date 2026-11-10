"use client";

import type { LocalePreferenceSaving } from "@/features/account/switch-locale";
import { languageNames } from "@/features/i18n/language-labels";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { LanguageMenu } from "@/shared/components/locale-switcher";
import { m } from "./i18n";

/**
 * The administration header's language menu, which switches the way the
 * customer site header does, saving a signed-in customer account's preference
 * first.
 */
export function AdministrationLocaleSwitcher({
  localePreference,
}: {
  readonly localePreference?: LocalePreferenceSaving;
}) {
  const locale = useRouteLocale();
  return (
    <LanguageMenu
      locale={locale}
      triggerLabel={m.shellLanguageMenuTriggerLabel(
        { language: languageNames[locale] },
        { locale }
      )}
      tone="light"
      localePreference={localePreference}
    />
  );
}
