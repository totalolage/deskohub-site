export type TranslatedRecord<Locale extends string> = Partial<
  Record<Locale | string, string>
>;

export type TranslatableValue<Locale extends string> =
  | string
  | TranslatedRecord<Locale>;

export function getTranslatedValue<
  Locale extends string,
  D extends string | null | undefined,
>(
  value: TranslatableValue<Locale> | null | undefined,
  locale: Locale,
  defaultValue?: D
): string | D | undefined {
  if (!value) return defaultValue;
  if (typeof value === "string") return value;

  const localeTranslation = value[locale];
  if (localeTranslation) return localeTranslation;

  const [baseLanguage] = locale.split("-");
  const languageTranslation = baseLanguage ? value[baseLanguage] : undefined;
  if (languageTranslation) return languageTranslation;

  return defaultValue;
}
