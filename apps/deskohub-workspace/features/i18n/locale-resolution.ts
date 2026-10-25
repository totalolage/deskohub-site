import {
  parseAcceptLanguage,
  resolveLocaleFromPolicy,
  resolvePreferredLocale,
} from "@deskohub/i18n/core";
import { getLocaleFromPathname } from "@deskohub/i18n/pathname";
import type { Locale } from "./paraglide/runtime.js";
import { localeConfig, localeCookieName, locales } from "./routing";

/**
 * The request facts the Workspace locale chain reads. `pathname` is the page
 * the request concerns: the requested URL for page requests, the referring
 * page for Server Actions.
 */
type LocaleRequestSources = {
  readonly pathname: string | undefined;
  readonly cookies: {
    readonly get: (name: string) => { readonly value: string } | undefined;
  };
  readonly headers: Pick<Headers, "get">;
};

/**
 * The single Workspace locale chain: a signed-in customer's saved language
 * preference, then the URL path locale, the locale cookie, Accept-Language,
 * and a fallback: Czech when the request states no language, English when
 * it names only languages the site doesn't serve. Guests have no saved
 * preference.
 */
export const resolveWorkspaceLocale = (
  { pathname, cookies, headers }: LocaleRequestSources,
  savedPreference: Locale | undefined
): Locale => {
  if (savedPreference) return savedPreference;

  const acceptLanguage = headers.get("accept-language");
  return resolveLocaleFromPolicy({
    localeFromUrl: pathname && getLocaleFromPathname(pathname, locales),
    localeFromCookie: cookies.get(localeCookieName)?.value,
    localeFromPreferredLanguage: resolvePreferredLocale({
      headerValue: acceptLanguage,
      locales,
      preferredLanguageToLocale: localeConfig.preferredLanguageToLocale,
    }),
    locales,
    fallbackLocale:
      parseAcceptLanguage(acceptLanguage).length === 0
        ? localeConfig.unstatedLanguageLocale
        : localeConfig.unservedLanguageLocale,
  });
};
