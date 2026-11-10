/**
 * The locale registry: every locale Deskohub serves and the facts about it
 * that other code reads instead of repeating its own locale list. Adding a
 * locale is one entry here plus its message catalogs; the Workspace inlang
 * projects list the same tags, which their drift tests check.
 */

/**
 * The writing system a locale's text is set in, which picks its fonts.
 * Vietnamese is Latin, but its stacked diacritics need a font that covers
 * them all, so it is its own script here.
 */
export type LocaleScript =
  | "latin"
  | "latin-vietnamese"
  | "cyrillic"
  | "devanagari";

/** The direction a locale's text runs. */
export type LocaleDirection = "ltr" | "rtl";

type LocaleEntry<Tag extends string> = {
  /** The BCP 47 tag, the locale's identity across URLs, cookies and storage. */
  readonly tag: Tag;
  /** The ISO 639-1 language subtag a browser or device language matches on. */
  readonly language: string;
  /** The ISO 3166-1 alpha-2 region subtag. */
  readonly region: string;
  /** The language's name in itself, as a language picker shows it. */
  readonly nativeName: string;
  readonly direction: LocaleDirection;
  readonly script: LocaleScript;
  /**
   * The locales whose authored content (email and campaign copy) stands in,
   * in order, when content in this locale is missing.
   */
  readonly fallbackChain: readonly NoInfer<Tag>[];
  /**
   * The ISO 639-2 code the Nexi hosted payment page shows its text in; a
   * language Nexi doesn't offer names the language its readers get instead.
   */
  readonly nexiLanguage: string;
  /**
   * The ISO 3166-1 alpha-2 region a phone number without a country calling
   * code is read in.
   */
  readonly phoneRegion: string;
};

const defineLocaleRegistry = <const Tag extends string>(
  entries: readonly [LocaleEntry<Tag>, ...LocaleEntry<Tag>[]]
) => entries;

const localeEntries = defineLocaleRegistry([
  {
    tag: "en-US",
    language: "en",
    region: "US",
    nativeName: "English",
    direction: "ltr",
    script: "latin",
    fallbackChain: ["cs-CZ"],
    nexiLanguage: "eng",
    phoneRegion: "CZ",
  },
  {
    tag: "cs-CZ",
    language: "cs",
    region: "CZ",
    nativeName: "Čeština",
    direction: "ltr",
    script: "latin",
    fallbackChain: ["en-US"],
    nexiLanguage: "cze",
    phoneRegion: "CZ",
  },
  {
    tag: "de-DE",
    language: "de",
    region: "DE",
    nativeName: "Deutsch",
    direction: "ltr",
    script: "latin",
    fallbackChain: ["en-US", "cs-CZ"],
    nexiLanguage: "deu",
    phoneRegion: "DE",
  },
  {
    tag: "uk-UA",
    language: "uk",
    region: "UA",
    nativeName: "Українська",
    direction: "ltr",
    script: "cyrillic",
    fallbackChain: ["en-US", "cs-CZ"],
    // Nexi's hosted page offers no Ukrainian.
    nexiLanguage: "eng",
    phoneRegion: "UA",
  },
  {
    tag: "sk-SK",
    language: "sk",
    region: "SK",
    nativeName: "Slovenčina",
    direction: "ltr",
    script: "latin",
    fallbackChain: ["cs-CZ", "en-US"],
    nexiLanguage: "slk",
    phoneRegion: "SK",
  },
  {
    tag: "vi-VN",
    language: "vi",
    region: "VN",
    nativeName: "Tiếng Việt",
    direction: "ltr",
    script: "latin-vietnamese",
    fallbackChain: ["en-US", "cs-CZ"],
    // Nexi's hosted page offers no Vietnamese.
    nexiLanguage: "eng",
    phoneRegion: "VN",
  },
  {
    tag: "hi-IN",
    language: "hi",
    region: "IN",
    nativeName: "हिन्दी",
    direction: "ltr",
    script: "devanagari",
    fallbackChain: ["en-US", "cs-CZ"],
    // Nexi's hosted page offers no Hindi.
    nexiLanguage: "eng",
    phoneRegion: "IN",
  },
]);

/** A locale Deskohub serves. */
export type SupportedLocale = (typeof localeEntries)[number]["tag"];

/** Everything the registry records about one {@link SupportedLocale}. */
export type LocaleDefinition = LocaleEntry<SupportedLocale>;

/** Every supported locale, base locale first. */
export const supportedLocales: readonly [
  SupportedLocale,
  ...SupportedLocale[],
] = localeEntries.map((entry) => entry.tag) as [
  SupportedLocale,
  ...SupportedLocale[],
];

/**
 * The locale message catalogs are written in first and that a message
 * missing from another catalog falls back to.
 */
export const baseLocale = "en-US" satisfies SupportedLocale;

/**
 * The locale a visitor who states no language gets: Czech, the primary
 * market.
 */
export const unstatedLanguageLocale = "cs-CZ" satisfies SupportedLocale;

/** The locale a visitor who states only languages Deskohub doesn't serve gets. */
export const unservedLanguageLocale = "en-US" satisfies SupportedLocale;

const definitionByLocale = Object.fromEntries(
  localeEntries.map((entry) => [entry.tag, entry])
) as Readonly<Record<SupportedLocale, LocaleDefinition>>;

export const isSupportedLocale = (value: string): value is SupportedLocale =>
  Object.hasOwn(definitionByLocale, value);

export const getLocaleDefinition = (
  locale: SupportedLocale
): LocaleDefinition => definitionByLocale[locale];

/**
 * The supported locale each language subtag reads, so a browser's `de-AT`
 * or a device's bare `sk` finds the locale of its language.
 */
export const localeByLanguage: Readonly<
  Partial<Record<string, SupportedLocale>>
> = Object.assign(
  Object.create(null),
  Object.fromEntries(localeEntries.map((entry) => [entry.language, entry.tag]))
);

/**
 * The supported locale a language tag such as `de-AT` or `sk` reads, by its
 * language subtag, or `undefined` when Deskohub doesn't serve the language.
 */
export const matchSupportedLocale = (
  languageTag: string
): SupportedLocale | undefined => {
  const language = languageTag.trim().split(/[-_]/)[0]?.toLowerCase();
  return language ? localeByLanguage[language] : undefined;
};

/**
 * A record with one value per supported locale, so a map keyed by locale
 * stays complete when a locale is added.
 */
export const mapSupportedLocales = <Value>(
  valueFor: (locale: SupportedLocale) => Value
): Readonly<Record<SupportedLocale, Value>> =>
  Object.fromEntries(
    supportedLocales.map((locale) => [locale, valueFor(locale)])
  ) as Record<SupportedLocale, Value>;
