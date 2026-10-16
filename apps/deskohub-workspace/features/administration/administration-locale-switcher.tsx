"use client";

import { type MouseEvent, Suspense } from "react";
import type { LocalePreferenceSaving } from "@/features/account/switch-locale";
import { type Locale, locales } from "@/features/i18n";
import { getLanguageLabels } from "@/features/i18n/language-labels";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { useLocaleSwitch } from "@/shared/components/locale-switcher-links";
import { m } from "./i18n";

type LocaleOptionsProps = {
  readonly currentLocale: Locale;
  readonly label: string;
  readonly languageLabels: Record<Locale, string>;
};

function LocaleOptions({
  currentLocale,
  label,
  languageLabels,
  getLocaleHref,
  selectLocale,
}: LocaleOptionsProps & {
  readonly getLocaleHref?: (locale: Locale) => string;
  readonly selectLocale?: (
    locale: Locale,
    event: MouseEvent<HTMLAnchorElement>
  ) => void;
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex items-center gap-1 text-sm">
        {locales.map((locale) => (
          <li key={locale}>
            {locale === currentLocale || !getLocaleHref ? (
              <span
                aria-current={locale === currentLocale ? "true" : undefined}
                className={
                  locale === currentLocale
                    ? "block rounded-md bg-navy-blue/[0.06] px-2.5 py-1.5 font-semibold text-navy-blue"
                    : "block px-2.5 py-1.5 text-navy-blue/65"
                }
              >
                {languageLabels[locale]}
              </span>
            ) : (
              <a
                className="block rounded-md px-2.5 py-1.5 text-navy-blue/65 transition-colors hover:bg-navy-blue/[0.035] hover:text-navy-blue"
                href={getLocaleHref(locale)}
                hrefLang={locale}
                onClick={(event) => selectLocale?.(locale, event)}
              >
                {languageLabels[locale]}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function LocaleSwitchLinks({
  localePreference,
  ...props
}: LocaleOptionsProps & {
  readonly localePreference?: LocalePreferenceSaving;
}) {
  const { getLocaleHref, selectLocale } = useLocaleSwitch(localePreference);
  return (
    <LocaleOptions
      {...props}
      getLocaleHref={getLocaleHref}
      selectLocale={selectLocale}
    />
  );
}

/**
 * Switches the administration between locales the way the customer site
 * header does, saving a signed-in customer account's preference first.
 */
export function AdministrationLocaleSwitcher({
  localePreference,
}: {
  readonly localePreference?: LocalePreferenceSaving;
}) {
  const locale = useRouteLocale();
  const props = {
    currentLocale: locale,
    label: m.shellLanguageSwitcherLabel({}, { locale }),
    languageLabels: getLanguageLabels(locale),
  };
  return (
    <Suspense fallback={<LocaleOptions {...props} />}>
      <LocaleSwitchLinks {...props} localePreference={localePreference} />
    </Suspense>
  );
}
