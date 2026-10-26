import { replaceLocaleInPathname } from "@deskohub/i18n/pathname";
import type { AppRouteHandlerRoutes, AppRoutes } from "@/.next/types/routes";
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
 * A page or route handler Next generated under the locale segment, except
 * catch-all routes, which a path builder can't fill.
 */
export type LocalizedRoute = Exclude<
  Extract<
    AppRoutes | AppRouteHandlerRoutes,
    `${typeof localeRouteSegment}/${string}`
  >,
  `${string}[...${string}` | `${string}[[...${string}`
>;

type RoutePathname<Route extends LocalizedRoute> =
  Route extends `${typeof localeRouteSegment}${infer Pathname}`
    ? Pathname
    : never;

type RouteParamName<Pathname extends string> =
  Pathname extends `${string}[${infer Name}]${infer Rest}`
    ? Name | RouteParamName<Rest>
    : never;

type FilledPathname<Pathname extends string> =
  Pathname extends `${infer Head}[${string}]${infer Rest}`
    ? `${Head}${string}${FilledPathname<Rest>}`
    : Pathname;

/** The path a route builds to, with each `[param]` segment filled. */
export type UnprefixedRoutePath<Route extends LocalizedRoute> = FilledPathname<
  RoutePathname<Route>
>;

/** The values a route's `[param]` segments take; a static route takes none. */
export type LocalizedRouteParams<Route extends LocalizedRoute> = [
  RouteParamName<RoutePathname<Route>>,
] extends [never]
  ? []
  : [
      params: Readonly<
        Record<RouteParamName<RoutePathname<Route>>, string | number>
      >,
    ];

/**
 * Builds a path without a locale prefix to a page or route handler Next
 * generated from the app directory, filling each `[param]` segment with its
 * encoded value, so typecheck proves the route exists and every parameter is
 * given. The proxy redirects it to the visitor's locale; place it under a
 * locale with `getLocalizedPagePath` instead when the locale is known.
 */
export const getUnprefixedPagePath = <Route extends LocalizedRoute>(
  route: Route,
  ...[params]: LocalizedRouteParams<Route>
): UnprefixedRoutePath<Route> => {
  const values: Readonly<Record<string, string | number>> = params ?? {};
  return route
    .slice(localeRouteSegment.length)
    .replace(/\[([^\]]+)\]/g, (_, name: string) =>
      encodeURIComponent(values[name] ?? "")
    ) as UnprefixedRoutePath<Route>;
};

/**
 * Builds a localized path to a page or route handler Next generated from the
 * app directory, with each `[param]` segment filled and encoded, so typecheck
 * proves the route exists and every parameter is given.
 */
export const getLocalizedPagePath = <Route extends LocalizedRoute>(
  locale: Locale,
  route: Route,
  ...params: LocalizedRouteParams<Route>
): string => `/${locale}${getUnprefixedPagePath(route, ...params)}`;

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
