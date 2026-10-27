import { prefixPathnameWithLocale } from "@deskohub/i18n/pathname";
import type { Locale } from "@/features/i18n";
import {
  getUnprefixedPagePath,
  type LocalizedRoute,
  type LocalizedRouteParams,
  type UnprefixedRoutePath,
} from "@/features/i18n/routing";

/** A page or route handler of the administration. */
type AdministrationRoute = Extract<
  LocalizedRoute,
  "/[locale]/admin" | `/[locale]/admin/${string}`
>;

/** The unprefixed path of an administration route `administrationHref` built. */
export type AdministrationPath = UnprefixedRoutePath<AdministrationRoute>;

/**
 * An administration path without a locale prefix, optionally followed by a
 * query or fragment. The type proves only the prefix; build the path with
 * `administrationHref` so typecheck also proves the route exists.
 */
export type AdministrationHref =
  | "/admin"
  | `/admin/${string}`
  | `/admin?${string}`
  | `/admin#${string}`;

/**
 * Builds the unprefixed path to an administration route, filling and encoding
 * its `[param]` segments, so typecheck proves the route exists.
 * `AdministrationLink` places it under the route locale; the proxy redirects
 * it when it leaves the app.
 */
export const administrationHref = <Route extends AdministrationRoute>(
  route: Route,
  ...params: LocalizedRouteParams<Route>
) => getUnprefixedPagePath(route, ...params);

/** Places an administration href under the locale segment. */
export const localizeAdministrationHref = (
  href: AdministrationHref,
  locale: Locale
) => prefixPathnameWithLocale(href, locale);
