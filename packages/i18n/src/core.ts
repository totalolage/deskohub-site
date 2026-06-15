type LocaleList<Locale extends string> = readonly Locale[];

function normalizeLocaleSubtag(subtag: string): string {
  const trimmedSubtag = subtag.trim();
  if (/^[a-zA-Z]{4}$/.test(trimmedSubtag)) {
    return `${trimmedSubtag.slice(0, 1).toUpperCase()}${trimmedSubtag
      .slice(1)
      .toLowerCase()}`;
  }
  if (/^[a-zA-Z]{2}$/.test(trimmedSubtag) || /^\d{3}$/.test(trimmedSubtag)) {
    return trimmedSubtag.toUpperCase();
  }
  return trimmedSubtag;
}

export type LocaleConfig<Locale extends string> = {
  locales: LocaleList<Locale>;
  baseLocale: Locale;
  preferredLanguageToLocale?: Partial<Record<string, Locale>>;
};

export function normalizeLocaleTag(locale: string): string {
  const [languagePart, ...rest] = locale.trim().split("-");
  if (!languagePart) return locale;

  const language = languagePart.toLowerCase();
  if (rest.length === 0) return language;

  const [secondSubtag, ...tail] = rest;
  const region = secondSubtag ? normalizeLocaleSubtag(secondSubtag) : "";
  const suffix = tail
    .map((segment) => normalizeLocaleSubtag(segment))
    .filter((segment) => segment.length > 0)
    .join("-");

  return suffix.length > 0
    ? `${language}-${region}-${suffix}`
    : `${language}-${region}`;
}

export function isLocale<Locale extends string>(
  locales: LocaleList<Locale>,
  value: string
): value is Locale {
  return locales.includes(value as Locale);
}

type ParsedAcceptLanguageEntry = {
  localeToken: string;
  normalizedLocaleToken: string;
  baseLanguage: string;
  quality: number;
  order: number;
};

export function parseAcceptLanguage(headerValue: string | null | undefined) {
  if (!headerValue) return [] as ParsedAcceptLanguageEntry[];

  const parsedEntries = headerValue
    .split(",")
    .map((token, index) => {
      const [localeToken = "", ...params] = token.trim().split(";");
      if (!localeToken || localeToken === "*") return undefined;

      const qValue = params.find((part) => part.trim().startsWith("q="));
      const qualityText = qValue?.split("=")[1]?.trim();
      const quality = Number.parseFloat(qualityText ?? "1");

      if (Number.isNaN(quality) || quality <= 0) return undefined;

      const normalizedLocaleToken = normalizeLocaleTag(localeToken);
      const [baseLanguagePart] = normalizedLocaleToken.split("-");
      const baseLanguage = baseLanguagePart?.toLowerCase();
      if (!baseLanguage) return undefined;

      return {
        localeToken,
        normalizedLocaleToken,
        baseLanguage,
        quality: Math.min(quality, 1),
        order: index,
      } satisfies ParsedAcceptLanguageEntry;
    })
    .filter((entry): entry is ParsedAcceptLanguageEntry => Boolean(entry));

  return parsedEntries.sort((left, right) => {
    if (right.quality !== left.quality) return right.quality - left.quality;
    return left.order - right.order;
  });
}

type ResolvePreferredLocaleOptions<Locale extends string> = {
  headerValue: string | null | undefined;
  locales: LocaleList<Locale>;
  preferredLanguageToLocale?: Partial<Record<string, Locale>>;
};

export function resolvePreferredLocale<Locale extends string>({
  headerValue,
  locales,
  preferredLanguageToLocale,
}: ResolvePreferredLocaleOptions<Locale>): Locale | undefined {
  const localeByNormalizedToken = new Map(
    locales.map((locale) => [normalizeLocaleTag(locale), locale])
  );

  for (const token of parseAcceptLanguage(headerValue)) {
    const directLocale = localeByNormalizedToken.get(
      token.normalizedLocaleToken
    );
    if (directLocale) return directLocale;

    const mappedLocale = preferredLanguageToLocale?.[token.baseLanguage];
    if (mappedLocale) return mappedLocale;
  }

  return undefined;
}

type ResolveLocaleInput<Locale extends string> = {
  localeFromUrl?: string;
  localeFromCookie?: string;
  localeFromPreferredLanguage?: Locale;
  locales: LocaleList<Locale>;
  fallbackLocale: Locale;
};

export function resolveLocaleFromPolicy<Locale extends string>({
  localeFromUrl,
  localeFromCookie,
  localeFromPreferredLanguage,
  locales,
  fallbackLocale,
}: ResolveLocaleInput<Locale>): Locale {
  if (localeFromUrl && isLocale(locales, localeFromUrl)) return localeFromUrl;
  if (localeFromCookie && isLocale(locales, localeFromCookie)) {
    return localeFromCookie;
  }
  if (localeFromPreferredLanguage) return localeFromPreferredLanguage;
  return fallbackLocale;
}
