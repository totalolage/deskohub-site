"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import {
  type LocalePreferenceSaving,
  switchLocale,
} from "@/features/account/switch-locale";
import {
  type Locale,
  locales,
  withLocalePrefixAndSearch,
} from "@/features/i18n";
import { cn } from "@/shared/utils";

type LocaleSwitcherLinksProps = {
  readonly currentLocale: Locale;
  readonly languageLabels: Record<Locale, string>;
  readonly closeMenu?: () => void;
  readonly isMobile?: boolean;
  readonly localePreference?: LocalePreferenceSaving;
};

type SignedInState = "pending" | boolean;

const useSignedIn = (localePreference?: LocalePreferenceSaving) => {
  const [signedIn, setSignedIn] = useState<SignedInState>("pending");
  useEffect(() => {
    let current = true;
    localePreference?.signedIn.then(
      (value) => {
        if (current) setSignedIn(value);
      },
      () => {
        if (current) setSignedIn(false);
      }
    );
    return () => {
      current = false;
    };
  }, [localePreference]);
  return signedIn;
};

const isPlainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/**
 * Hrefs and click handling for links that switch the current page to another
 * locale.
 */
export function useLocaleSwitch(localePreference?: LocalePreferenceSaving) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const signedIn = useSignedIn(localePreference);

  const getLocaleHref = (locale: Locale) =>
    withLocalePrefixAndSearch(pathname, locale, searchParams);

  // Guests keep plain document navigation. A signed-in switch goes through
  // the shared locale switch, which saves the preference before navigating.
  // A click before the session check settles waits for it, so an early
  // signed-in switch is not redirected back to the old preference.
  const selectLocale =
    localePreference && signedIn !== false
      ? (locale: Locale, event: MouseEvent<HTMLAnchorElement>) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          void switchLocale(locale, localePreference);
        }
      : undefined;

  return { getLocaleHref, selectLocale };
}

export function LocaleSwitcherLinks({
  currentLocale,
  languageLabels,
  closeMenu,
  isMobile = false,
  localePreference,
}: LocaleSwitcherLinksProps) {
  const { getLocaleHref, selectLocale } = useLocaleSwitch(localePreference);

  return (
    <LocaleSwitcherLabels
      currentLocale={currentLocale}
      languageLabels={languageLabels}
      closeMenu={closeMenu}
      getLocaleHref={getLocaleHref}
      isMobile={isMobile}
      selectLocale={selectLocale}
    />
  );
}

export function LocaleSwitcherLabels({
  currentLocale,
  languageLabels,
  closeMenu,
  getLocaleHref,
  isMobile = false,
  selectLocale,
}: Omit<LocaleSwitcherLinksProps, "localePreference"> & {
  readonly getLocaleHref?: (locale: Locale) => string;
  readonly selectLocale?: (
    locale: Locale,
    event: MouseEvent<HTMLAnchorElement>
  ) => void;
}) {
  return locales.map((locale, index) => {
    const isCurrent = locale === currentLocale;
    let label: ReactNode = languageLabels[locale];

    if (isCurrent) {
      label = <strong className="text-white">{languageLabels[locale]}</strong>;
    } else if (getLocaleHref) {
      label = (
        <a
          href={getLocaleHref(locale)}
          onClick={(event) => {
            closeMenu?.();
            selectLocale?.(locale, event);
          }}
          className="transition-colors hover:text-sunset-yellow"
        >
          {languageLabels[locale]}
        </a>
      );
    }

    if (isMobile) {
      return <Fragment key={locale}>{label}</Fragment>;
    }

    return (
      <span
        key={locale}
        className={cn(
          index > 0 &&
            "before:absolute before:translate-x-[0.5ch] before:text-white/28 before:content-['/']"
        )}
      >
        {index > 0 && <br />}
        {label}
      </span>
    );
  });
}
