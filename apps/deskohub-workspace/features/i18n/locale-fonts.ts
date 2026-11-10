import {
  getLocaleDefinition,
  type LocaleScript,
} from "@deskohub/i18n/locale-registry";
import localFont from "next/font/local";
import type { Locale } from "./paraglide/runtime.js";

/*
 * Companion faces supply the letters of a script the brand face lacks. Each
 * one's unicode-range limits it to that script, and it follows the brand face
 * directly: the brand face keeps every character it has, and the companion
 * comes before the brand face's metric-matched Arial fallback, which has
 * Cyrillic and would otherwise take those letters. The browser fetches a
 * companion only for a page whose text uses its range, and only pages of that
 * script list it.
 *
 * A face that should set a whole page, as Montserrat will for Vietnamese,
 * which shares the Latin script with the brand face, goes ahead of the brand
 * face without a unicode-range and is keyed by locale rather than script; the
 * wordmark then needs a brand-only variable of its own.
 */

/**
 * Montserrat for Ukrainian: Google Fonts' cyrillic subset plus the modifier
 * apostrophe Ukrainian writes inside words. size-adjust matches its x-height
 * (517) to Sculpin's (510).
 */
const montserratCyrillic = localFont({
  src: "../../assets/fonts/Montserrat/cyrillic.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  // Latin pages never use it, so no page preloads it.
  preload: false,
  // Sculpin's metric-matched fallback follows it in the stack, so it needs
  // none of its own.
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+02BC, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
    { prop: "size-adjust", value: "98.6%" },
  ],
});

/** The companion family each script's letters come from. */
const scriptCompanionFamilies: Readonly<
  Record<LocaleScript, string | undefined>
> = {
  latin: undefined,
  cyrillic: montserratCyrillic.style.fontFamily,
  // Hindi will take Poppins limited to Devanagari, its joiners and the rupee
  // sign (U+0900-097F, U+200C-200D, U+20B9), with a line height of 1.6-1.75.
  devanagari: undefined,
};

/**
 * The brand font stack a locale's pages use. `brandFamilies` is the brand
 * font's family list as next/font gives it, the face first and its
 * metric-matched fallback after; the companion for the locale's script goes
 * between them. Undefined when the script needs no companion.
 */
export const getLocaleBrandFontStack = (
  locale: Locale,
  brandFamilies: string
): string | undefined => {
  const companion = scriptCompanionFamilies[getLocaleDefinition(locale).script];
  if (!companion) return undefined;
  const [brandFace, ...brandFallbacks] = brandFamilies.split(", ");
  return [brandFace, companion, ...brandFallbacks].join(", ");
};
