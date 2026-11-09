"use client";

import { Check, ChevronDown, Languages } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  type ComponentProps,
  type MouseEvent,
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
import { languageNames } from "@/features/i18n/language-labels";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
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

type SelectLocale = (
  locale: Locale,
  event: MouseEvent<HTMLAnchorElement>
) => void;

/**
 * Hrefs and click handling for links that switch the current page to another
 * locale, which the language menu and the language links render.
 */
function useLocaleSwitch(localePreference?: LocalePreferenceSaving) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const signedIn = useSignedIn(localePreference);

  const getLocaleHref = (locale: Locale) =>
    withLocalePrefixAndSearch(pathname, locale, searchParams);

  // Guests keep plain document navigation. A signed-in switch goes through
  // the shared locale switch, which saves the preference before navigating.
  // A click before the session check settles waits for it, so an early
  // signed-in switch is not redirected back to the old preference.
  const selectLocale: SelectLocale | undefined =
    localePreference && signedIn !== false
      ? (locale, event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          void switchLocale(locale, localePreference);
        }
      : undefined;

  return { getLocaleHref, selectLocale };
}

type LanguageMenuProps = {
  readonly locale: Locale;
  /** The trigger's accessible name, which names the current language. */
  readonly triggerLabel: string;
  /** `inverse` sits on the customer site's dark header, `light` on a white one. */
  readonly tone: "inverse" | "light";
  readonly localePreference?: LocalePreferenceSaving;
};

function LanguageMenuTrigger({
  locale,
  triggerLabel,
  tone,
  ...props
}: Omit<LanguageMenuProps, "localePreference"> &
  Omit<ComponentProps<typeof Button>, "className">) {
  return (
    <Button
      type="button"
      size="sm"
      shape="pill"
      aria-label={triggerLabel}
      className="shrink-0"
      variant="ghost"
      tone={tone === "inverse" ? "inverse" : "outline"}
      // biome-ignore lint/plugin: the menu trigger passes only its state, ARIA and event props, never a className.
      {...props}
    >
      <Languages aria-hidden className="size-4" />
      <span lang={locale} className="hidden sm:inline">
        {languageNames[locale]}
      </span>
      <ChevronDown aria-hidden className="size-3.5 opacity-70" />
    </Button>
  );
}

function LanguageMenuWithLinks({
  localePreference,
  ...props
}: LanguageMenuProps) {
  const { getLocaleHref, selectLocale } = useLocaleSwitch(localePreference);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <LanguageMenuTrigger {...props} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {locales.map((locale) => {
          const isCurrent = locale === props.locale;
          const label = (
            <>
              <Check
                aria-hidden
                className={cn(
                  "size-4 text-burned-orange",
                  !isCurrent && "invisible"
                )}
              />
              <span lang={locale}>{languageNames[locale]}</span>
            </>
          );
          return isCurrent ? (
            <DropdownMenuItem
              key={locale}
              aria-current="true"
              className="font-semibold"
            >
              {label}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={locale} asChild className="cursor-pointer">
              <a
                href={getLocaleHref(locale)}
                hrefLang={locale}
                onClick={(event) => selectLocale?.(locale, event)}
              >
                {label}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A compact header control that opens a menu of every language, each named in
 * itself. Choosing one opens the current page, query included, under that
 * locale, and a signed-in customer's preference is saved before the
 * navigation. The prerendered shell cannot read the query, so it shows the
 * trigger alone until the client takes over.
 */
export function LanguageMenu(props: LanguageMenuProps) {
  return (
    <Suspense fallback={<LanguageMenuTrigger {...props} />}>
      <LanguageMenuWithLinks {...props} />
    </Suspense>
  );
}

type LanguageLinksProps = {
  readonly locale: Locale;
  /** The navigation landmark's accessible name. */
  readonly label: string;
  readonly localePreference?: LocalePreferenceSaving;
  readonly className?: string;
};

function LanguageLinkList({
  locale: currentLocale,
  label,
  className,
  getLocaleHref,
  selectLocale,
}: Omit<LanguageLinksProps, "localePreference"> & {
  readonly getLocaleHref?: (locale: Locale) => string;
  readonly selectLocale?: SelectLocale;
}) {
  return (
    <nav aria-label={label} data-locale-switcher className={className}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {locales.map((locale) => (
          <li key={locale}>
            {locale === currentLocale || !getLocaleHref ? (
              <span
                lang={locale}
                aria-current={locale === currentLocale ? "true" : undefined}
                className={cn(
                  locale === currentLocale && "font-semibold text-white"
                )}
              >
                {languageNames[locale]}
              </span>
            ) : (
              <a
                href={getLocaleHref(locale)}
                hrefLang={locale}
                lang={locale}
                onClick={(event) => selectLocale?.(locale, event)}
                className="transition-colors hover:text-sunset-yellow"
              >
                {languageNames[locale]}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function LanguageLinksWithHrefs({
  localePreference,
  ...props
}: LanguageLinksProps) {
  const { getLocaleHref, selectLocale } = useLocaleSwitch(localePreference);
  return (
    <LanguageLinkList
      {...props}
      getLocaleHref={getLocaleHref}
      selectLocale={selectLocale}
    />
  );
}

/**
 * Every language as an inline row of links, each named in itself, for the
 * customer site footer. Switching works as in `LanguageMenu`; the prerendered
 * shell shows the names without links until the client takes over.
 */
export function LanguageLinks(props: LanguageLinksProps) {
  return (
    <Suspense fallback={<LanguageLinkList {...props} />}>
      <LanguageLinksWithHrefs {...props} />
    </Suspense>
  );
}
