"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  Suspense,
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
import { getLanguageLabels } from "@/features/i18n/language-labels";
import { cn } from "@/shared/utils";

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
 * locale. `LocaleSwitcher` renders them for the customer site; the
 * administration renders its own markup around them.
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

type LocaleSwitcherProps = {
  readonly locale: Locale;
  /** `stacked` separates the languages with a slash; `inline` runs them together in a row. */
  readonly appearance: "inline" | "stacked";
  readonly localePreference?: LocalePreferenceSaving;
  /** Runs on every click of another locale's link, for example to close a menu. */
  readonly onSwitch?: () => void;
};

type LocaleLabelsProps = Omit<LocaleSwitcherProps, "localePreference"> & {
  readonly getLocaleHref?: (locale: Locale) => string;
  readonly selectLocale?: (
    locale: Locale,
    event: MouseEvent<HTMLAnchorElement>
  ) => void;
};

function LocaleLabels({
  locale: currentLocale,
  appearance,
  onSwitch,
  getLocaleHref,
  selectLocale,
}: LocaleLabelsProps) {
  const languageLabels = getLanguageLabels(currentLocale);

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
            onSwitch?.();
            selectLocale?.(locale, event);
          }}
          className="transition-colors hover:text-sunset-yellow"
        >
          {languageLabels[locale]}
        </a>
      );
    }

    if (appearance === "inline") {
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

function LocaleLinks({ localePreference, ...props }: LocaleSwitcherProps) {
  const { getLocaleHref, selectLocale } = useLocaleSwitch(localePreference);
  return (
    <LocaleLabels
      {...props}
      getLocaleHref={getLocaleHref}
      selectLocale={selectLocale}
    />
  );
}

/**
 * The customer site's language links, each named in the current locale's
 * language. Another locale's link opens the current page, query included,
 * under that locale, and a signed-in customer's preference is saved before the
 * navigation. The prerendered shell cannot read the query, so it shows the
 * same labels without links until the client takes over.
 */
export function LocaleSwitcher({
  locale,
  appearance,
  localePreference,
  onSwitch,
}: LocaleSwitcherProps) {
  return (
    <Suspense
      fallback={<LocaleLabels locale={locale} appearance={appearance} />}
    >
      <LocaleLinks
        locale={locale}
        appearance={appearance}
        localePreference={localePreference}
        onSwitch={onSwitch}
      />
    </Suspense>
  );
}
