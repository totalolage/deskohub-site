/** `text` with its first character upper-cased for `locale`, as a sentence starts. */
export const upperCaseFirst = (text: string, locale: string) =>
  `${text.charAt(0).toLocaleUpperCase(locale)}${text.slice(1)}`;
