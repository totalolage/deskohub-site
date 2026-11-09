/** `text` with its first character upper-cased for `locale`, as a sentence starts. */
export const upperCaseFirst = (text: string, locale: string) =>
  `${text.charAt(0).toLocaleUpperCase(locale)}${text.slice(1)}`;

/** Languages whose nouns keep their capital letter inside a sentence. */
const nounCapitalizingLanguages: ReadonlySet<string> = new Set(["de"]);

/**
 * A common-noun label ("Meeting room") as it reads inside a sentence in
 * `locale`: lower-cased, except in languages that capitalise nouns, where
 * "Meetingraum" stays "Meetingraum". Not for proper names or acronyms.
 */
export const nounInSentence = (text: string, locale: string) =>
  nounCapitalizingLanguages.has(new Intl.Locale(locale).language)
    ? text
    : text.toLocaleLowerCase(locale);

/** `text` lower-cased without accents, so "Výprodej" and "vyprodej" compare equal. */
const foldForSearch = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Whether `text` contains `search`, ignoring case and accents. */
export const includesSearchText = (text: string, search: string) =>
  foldForSearch(text).includes(foldForSearch(search.trim()));
