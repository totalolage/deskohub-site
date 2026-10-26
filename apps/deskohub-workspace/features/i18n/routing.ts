import { replaceLocaleInPathname } from "@deskohub/i18n/pathname";
import type { AppRoutes } from "@/.next/types/routes";
import {
  baseLocale,
  cookieName,
  type Locale,
  locales,
} from "./paraglide/runtime.js";

export { cookieName as localeCookieName, locales };

export const defaultLocale: Locale = baseLocale;

export const localeConfig = {
  locales,
  // Czech is the primary market: a request that states no language, such as
  // a crawler's, opens the Czech site.
  unstatedLanguageLocale: "cs-CZ",
  // A visitor whose languages the site doesn't serve reads English.
  unservedLanguageLocale: "en-US",
  // Maps the browser's Accept-Language, not the saved locale preference, and
  // a bare language segment in the URL (`/en/faq`). Slovak readers get Czech.
  preferredLanguageToLocale: {
    cs: "cs-CZ",
    sk: "cs-CZ",
    en: "en-US",
  },
} as const satisfies {
  readonly locales: readonly Locale[];
  readonly unstatedLanguageLocale: Locale;
  readonly unservedLanguageLocale: Locale;
  readonly preferredLanguageToLocale: Readonly<Record<string, Locale>>;
};

const withLocalePrefix = (pathname: string, locale: Locale): string =>
  replaceLocaleInPathname(pathname, locale, locales);

const localeRouteSegment = "/[locale]";

export type StaticLocalizedPageRoute = Exclude<
  Extract<AppRoutes, `${typeof localeRouteSegment}/${string}`>,
  `${typeof localeRouteSegment}/${string}[${string}`
>;

/**
 * Builds a page path without a locale prefix from a route Next generated
 * from the app directory, so typecheck proves the page exists. The proxy
 * redirects it to the visitor's locale.
 */
export const getPagePath = (route: StaticLocalizedPageRoute): string =>
  route.slice(localeRouteSegment.length);

/**
 * Builds a localized page path from a route Next generated from the app
 * directory, so typecheck proves the page exists.
 */
export const getLocalizedPagePath = (
  locale: Locale,
  route: StaticLocalizedPageRoute
): string => `/${locale}${route.slice(localeRouteSegment.length)}`;

type DynamicLocalizedPageRoute = Exclude<
  Extract<AppRoutes, `${typeof localeRouteSegment}/${string}[${string}`>,
  `${string}[...${string}` | `${string}[[...${string}`
>;

type PageRouteParamName<Route extends string> =
  Route extends `${string}[${infer Name}]${infer Rest}`
    ? Name | PageRouteParamName<Rest>
    : never;

type LocalizedPageRouteParams<Route extends DynamicLocalizedPageRoute> =
  Readonly<
    Record<
      PageRouteParamName<
        Route extends `${typeof localeRouteSegment}${infer Path}` ? Path : never
      >,
      string
    >
  >;

/**
 * Builds a localized path to a dynamic page Next generated from the app
 * directory, filling each `[param]` segment with its encoded value, so
 * typecheck proves the page exists and every parameter is given.
 */
export const getLocalizedDynamicPagePath = <
  Route extends DynamicLocalizedPageRoute,
>(
  locale: Locale,
  route: Route,
  params: LocalizedPageRouteParams<Route>
): string => {
  const values: Readonly<Record<string, string>> = params;
  return `/${locale}${route
    .slice(localeRouteSegment.length)
    .replace(/\[([^\]]+)\]/g, (_, name: string) =>
      encodeURIComponent(values[name] ?? "")
    )}`;
};

export const withLocalePrefixAndSearch = (
  pathname: string,
  locale: Locale,
  searchParams: Pick<URLSearchParams, "toString"> | string
): string => {
  const localizedPathname = withLocalePrefix(pathname, locale);
  const rawSearchString = String(searchParams);
  const searchString = rawSearchString.startsWith("?")
    ? rawSearchString.slice(1)
    : rawSearchString;

  if (!searchString) {
    return localizedPathname;
  }

  return `${localizedPathname}?${searchString}`;
};
