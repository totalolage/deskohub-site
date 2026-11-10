import {
  getLocaleDefinition,
  mapSupportedLocales,
} from "@deskohub/i18n/locale-registry";
import type { CSSProperties } from "react";
import type { Locale } from "./paraglide/runtime.js";

/**
 * Each locale's language named in itself, as a language picker shows it, so
 * a reader finds their language whatever the page's current one.
 */
export const languageNames: Readonly<Record<Locale, string>> =
  mapSupportedLocales((locale) => getLocaleDefinition(locale).nativeName);

/**
 * The custom property naming the face a language's own name is set in, which
 * the locale layout defines on every page for each script the brand face
 * lacks (`features/i18n/locale-fonts.ts`).
 */
export const languageNameFontProperty = (locale: Locale) =>
  `--font-language-name-${locale}` as const;

/**
 * The style for an element that shows a language's own name, so the name
 * keeps its script's face on every page rather than letters from a system
 * font: its name face, then the page's text stack. A Latin-script name takes
 * the page's face.
 */
export const languageNameStyle = (locale: Locale): CSSProperties | undefined =>
  getLocaleDefinition(locale).script === "latin"
    ? undefined
    : {
        fontFamily: `var(${languageNameFontProperty(locale)}), var(--font-body)`,
      };
