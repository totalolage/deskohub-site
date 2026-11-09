import * as m from "./paraglide/messages/_index.js";
import type { Locale } from "./paraglide/runtime.js";

/** Each locale's language name, in the language of `locale`. */
export const getLanguageLabels = (locale: Locale): Record<Locale, string> => ({
  "cs-CZ": m.languageCzech({}, { locale }),
  "en-US": m.languageEnglish({}, { locale }),
});
