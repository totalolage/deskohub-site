import { replaceLocaleInPathname } from "@deskohub/i18n/pathname";
import { Predicate } from "effect";
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
  baseLocale: defaultLocale,
  // Maps the browser's Accept-Language, not the saved locale preference.
  preferredLanguageToLocale: {
    cs: "cs-CZ",
    en: "en-US",
  },
} as const;

const withLocalePrefix = (pathname: string, locale: Locale): string =>
  replaceLocaleInPathname(pathname, locale, locales);

const localeRouteSegment = "/[locale]";

type StaticLocalizedPageRoute = Exclude<
  Extract<AppRoutes, `${typeof localeRouteSegment}/${string}`>,
  `${typeof localeRouteSegment}/${string}[${string}`
>;

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
  const rawSearchString = Predicate.isString(searchParams)
    ? searchParams
    : searchParams.toString();
  const searchString = rawSearchString.startsWith("?")
    ? rawSearchString.slice(1)
    : rawSearchString;

  if (!searchString) {
    return localizedPathname;
  }

  return `${localizedPathname}?${searchString}`;
};
