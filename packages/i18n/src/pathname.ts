type LocaleList<Locale extends string> = readonly Locale[];

const ensureLeadingSlash = (pathname: string) =>
  pathname.startsWith("/") ? pathname : `/${pathname}`;

const removeBoundarySlashes = (value: string) =>
  value.replaceAll(/(^\/|\/$)/g, "");

export function getLocaleFromPathname<Locale extends string>(
  pathname: string,
  locales: LocaleList<Locale>
): Locale | undefined {
  const normalizedPathname = ensureLeadingSlash(pathname);

  return locales.find(
    (locale) =>
      normalizedPathname === `/${locale}` ||
      normalizedPathname.startsWith(`/${locale}/`)
  );
}

/**
 * The pathname with its locale prefix spelled exactly, for a path whose first
 * segment loosely names a supported locale: the locale in another letter case
 * (`/en-us/faq`) or a bare language subtag that `languageToLocale` maps
 * (`/en/faq`). Undefined when the prefix is already exact or names no locale.
 */
export function findExactLocalePathname<Locale extends string>(
  pathname: string,
  locales: LocaleList<Locale>,
  languageToLocale: Partial<Record<string, Locale>> = {}
): string | undefined {
  const [, prefix = "", ...rest] = ensureLeadingSlash(pathname).split("/");
  if (locales.some((locale) => locale === prefix)) return undefined;

  const loosePrefix = prefix.toLowerCase();
  const locale =
    locales.find((candidate) => candidate.toLowerCase() === loosePrefix) ??
    (Object.hasOwn(languageToLocale, loosePrefix)
      ? languageToLocale[loosePrefix]
      : undefined);
  return locale && [`/${locale}`, ...rest].join("/");
}

export function parseLocalizedPathname<Locale extends string>(
  pathname: string,
  locales: LocaleList<Locale>
): {
  locale: Locale | undefined;
  pathname: string;
} {
  const normalizedPathname = ensureLeadingSlash(pathname);
  const extractedLocale = getLocaleFromPathname(normalizedPathname, locales);

  if (!extractedLocale) {
    return {
      locale: undefined,
      pathname: normalizedPathname,
    };
  }

  const strippedPathname =
    normalizedPathname.slice(extractedLocale.length + 1) || "/";

  return {
    locale: extractedLocale,
    pathname: strippedPathname,
  };
}

export function stripLocaleFromPathname<Locale extends string>(
  pathname: string,
  locales: LocaleList<Locale>
): string {
  return parseLocalizedPathname(pathname, locales).pathname;
}

export function pathnameHasLocale<Locale extends string>(
  pathname: string,
  locales: LocaleList<Locale>
): boolean {
  return parseLocalizedPathname(pathname, locales).locale !== undefined;
}

export function replaceLocaleInPathname<Locale extends string>(
  pathname: string,
  locale: Locale,
  locales: LocaleList<Locale>
): string {
  const pathnameWithoutLocale = stripLocaleFromPathname(pathname, locales);

  if (pathnameWithoutLocale === "/") return `/${locale}`;
  return `/${locale}/${removeBoundarySlashes(pathnameWithoutLocale)}`;
}

export function prefixPathnameWithLocale<Locale extends string>(
  pathname: string,
  locale: Locale
): string {
  const normalizedPathname = ensureLeadingSlash(pathname);
  if (normalizedPathname === "/") return `/${locale}`;
  return `/${locale}${normalizedPathname}`;
}

export function getLocalizedPathVariants<Locale extends string>(
  pathname: string,
  locales: LocaleList<Locale>
): Map<Locale, string> {
  const variants = locales.map((locale): [Locale, string] => [
    locale,
    replaceLocaleInPathname(pathname, locale, locales),
  ]);

  return new Map(variants);
}
