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
import {
  languageNameStyle,
  languageNames,
} from "@/features/i18n/language-labels";
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

/**
 * The order the language menu and links list the languages in: Czech first,
 * then English, then the rest in registry order (owner decision D23). The
 * registry keeps its own base-first order for everything else.
 */
const languageDisplayOrder: readonly Locale[] = [
  "cs-CZ",
  "en-US",
  ...locales.filter((locale) => locale !== "cs-CZ" && locale !== "en-US"),
];

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
  /**
   * The customer header's desktop navigation shares the bar from `xl` to
   * `2xl`, so the trigger drops the language name there and keeps the icon.
   */
  readonly sharesBarWithNavigation?: boolean;
  readonly localePreference?: LocalePreferenceSaving;
};

function LanguageMenuTrigger({
  locale,
  triggerLabel,
  tone,
  sharesBarWithNavigation = false,
  ...props
}: Omit<LanguageMenuProps, "localePreference"> &
  // Radix's trigger forwards only state, ARIA, event and ref props.
  Omit<ComponentProps<"button">, "className" | "type">) {
  return (
    <Button
      type="button"
      size="icon"
      shape="pill"
      aria-label={triggerLabel}
      data-language-menu-trigger
      className={cn(
        "shrink-0 sm:w-auto",
        sharesBarWithNavigation && "xl:max-2xl:w-10"
      )}
      variant="ghost"
      tone={tone === "inverse" ? "inverse" : "outline"}
      // biome-ignore lint/plugin: the menu trigger passes only its state, ARIA and event props, never a className.
      {...props}
    >
      {/* Phones get the icon alone in a round button; wider screens add the
          current language's name and a chevron. */}
      <span
        className={cn(
          "flex items-center gap-1.5 sm:px-3.5",
          sharesBarWithNavigation && "xl:max-2xl:px-0"
        )}
      >
        <Languages aria-hidden className="size-4.5" />
        <span
          lang={locale}
          className={cn(
            "hidden sm:inline",
            sharesBarWithNavigation && "xl:max-2xl:hidden"
          )}
        >
          {languageNames[locale]}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "hidden size-3.5 opacity-70 sm:block",
            sharesBarWithNavigation && "xl:max-2xl:hidden"
          )}
        />
      </span>
    </Button>
  );
}

function LanguageMenuWithLinks({
  localePreference,
  ...props
}: LanguageMenuProps) {
  const { getLocaleHref, selectLocale } = useLocaleSwitch(localePreference);
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <LanguageMenuTrigger {...props} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        data-locale-switcher
      >
        {languageDisplayOrder.map((locale) => {
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
              <span lang={locale} style={languageNameStyle(locale)}>
                {languageNames[locale]}
              </span>
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
                onClick={(event) => {
                  selectLocale?.(locale, event);
                  // A signed-in switch takes over the click to save the
                  // preference first, which also skips the menu's own close;
                  // close it so the save can't be started twice.
                  if (event.defaultPrevented) setOpen(false);
                }}
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
export function LanguageMenu({
  localePreference,
  ...props
}: LanguageMenuProps) {
  return (
    <Suspense fallback={<LanguageMenuTrigger {...props} />}>
      <LanguageMenuWithLinks {...props} localePreference={localePreference} />
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
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {languageDisplayOrder.map((locale) => (
          <li key={locale}>
            {locale === currentLocale || !getLocaleHref ? (
              <span
                lang={locale}
                style={languageNameStyle(locale)}
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
                style={languageNameStyle(locale)}
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
