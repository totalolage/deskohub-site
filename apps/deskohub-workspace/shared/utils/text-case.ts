/** `text` with its first character upper-cased for `locale`, as a sentence starts. */
export const upperCaseFirst = (text: string, locale: string) =>
  `${text.charAt(0).toLocaleUpperCase(locale)}${text.slice(1)}`;

/** `text` lower-cased without accents, so "Výprodej" and "vyprodej" compare equal. */
const foldForSearch = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Whether `text` contains `search`, ignoring case and accents. */
export const includesSearchText = (text: string, search: string) =>
  foldForSearch(text).includes(foldForSearch(search.trim()));
