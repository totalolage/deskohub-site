import {
  getLocaleDefinition,
  type LocaleScript,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import localFont from "next/font/local";
import type { CSSProperties } from "react";
import { languageNameFontProperty } from "./language-labels";
import type { Locale } from "./paraglide/runtime.js";

/*
 * Each script the brand face (Sculpin) can't set gets faces of its own, and
 * a locale's pages set their text in a stack built around the brand face's
 * families. None of these faces is preloaded: only pages of their script list
 * them, and the browser fetches a face only for a page whose text uses its
 * unicode-range. Sculpin's metric-matched Arial fallback stays last in every
 * stack, so the faces need no fallback of their own.
 *
 * - Companion faces supply the letters of a script the brand face lacks. A
 *   companion follows the brand face directly, limited by unicode-range to
 *   its script, so the brand face keeps every character it has and the
 *   companion comes before the Arial fallback, which would otherwise take
 *   those letters.
 * - A text face sets a whole page instead, ahead of the brand face, where
 *   mixing faces letter by letter would show. The brand wordmark keeps
 *   Sculpin through the `wordmark` font token.
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
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+02BC, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
    { prop: "size-adjust", value: "98.6%" },
  ],
});

/**
 * Montserrat sets Vietnamese pages whole: Sculpin has some of Vietnamese's
 * accented vowels but not the stacked ones, so within one word letters would
 * come from different fonts. Google Fonts' latin and vietnamese subsets in
 * one file, since every Vietnamese page needs both; size-adjust as for
 * Cyrillic.
 */
const montserratVietnamese = localFont({
  src: "../../assets/fonts/Montserrat/vietnamese.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0102-0103, U+0110-0111, U+0128-0129, U+0131, U+0152-0153, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+2000-206F, U+20AB-20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
    { prop: "size-adjust", value: "98.6%" },
  ],
});

/**
 * Montserrat's latin-ext subset, for the Czech place and street names
 * Vietnamese pages print (Libeň, Turnovská), so they stay in Montserrat. Only
 * a page that uses one of these letters fetches it.
 */
const montserratLatinExtended = localFont({
  src: "../../assets/fonts/Montserrat/latin-ext.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
    { prop: "size-adjust", value: "98.6%" },
  ],
});

/**
 * Poppins for Hindi's Devanagari, its joiners and the rupee sign, beside
 * Sculpin's Latin and digits. Poppins draws the Devanagari digit code points
 * as Western digits. Sized by eye: at 100% the headline stroke sits on
 * Sculpin's x-height, where x-height matching (93%) reads small. Static 400
 * and 600 instances; the browser sets medium text in 400 and bold in 600.
 * Hindi pages' line heights and letter spacing are in app/globals.css.
 */
const poppinsDevanagari = localFont({
  src: [
    { path: "../../assets/fonts/Poppins/devanagari-400.woff2", weight: "400" },
    { path: "../../assets/fonts/Poppins/devanagari-600.woff2", weight: "600" },
  ],
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF",
    },
  ],
});

/*
 * Language names: the language menu and links name every language in itself
 * on every page, so a name in a script the brand face lacks needs its
 * script's face on other locales' pages too. These faces hold only the
 * letters of the registry's native names in their script (a few kilobytes,
 * against tens for the full faces above), so every page can fetch them for
 * the footer's language links. Regenerate them when a native name changes
 * (the deskohub-i18n skill's add-a-locale reference has the command);
 * language-name-fonts.browser-acceptance.test.ts fails on a missing letter.
 */

/** Montserrat, as Vietnamese pages set "Tiếng Việt". */
const vietnameseLanguageName = localFont({
  src: "../../assets/fonts/Montserrat/language-name-vietnamese.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "size-adjust", value: "98.6%" }],
});

/** Montserrat's Cyrillic, as Ukrainian pages set "Українська". */
const cyrillicLanguageName = localFont({
  src: "../../assets/fonts/Montserrat/language-name-cyrillic.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "size-adjust", value: "98.6%" }],
});

/** Poppins' Devanagari, as Hindi pages set "हिन्दी". */
const devanagariLanguageName = localFont({
  src: [
    {
      path: "../../assets/fonts/Poppins/language-name-devanagari-400.woff2",
      weight: "400",
    },
    {
      path: "../../assets/fonts/Poppins/language-name-devanagari-600.woff2",
      weight: "600",
    },
  ],
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

/**
 * Devanagari letters Poppins lacks (rare and Vedic code points) come from the
 * platform's Devanagari font rather than whatever the browser picks.
 */
const devanagariSystemFamilies = [
  '"Noto Sans Devanagari"',
  '"Nirmala UI"',
  '"Kohinoor Devanagari"',
];

type ScriptTypography = {
  /** Families that set the page's text ahead of the brand face. */
  readonly textFaces?: readonly string[];
  /** Families after the brand face, ahead of its metric-matched fallback. */
  readonly companions?: readonly string[];
};

const scriptTypography: Readonly<Record<LocaleScript, ScriptTypography>> = {
  latin: {},
  "latin-vietnamese": {
    textFaces: [
      montserratVietnamese.style.fontFamily,
      montserratLatinExtended.style.fontFamily,
    ],
  },
  cyrillic: { companions: [montserratCyrillic.style.fontFamily] },
  devanagari: {
    companions: [
      poppinsDevanagari.style.fontFamily,
      ...devanagariSystemFamilies,
    ],
  },
};

/**
 * The style a locale's root element sets for its script: `--font-text`, the
 * stack the site's text font tokens read, built around `brandFamilies` (the
 * brand font's family list as next/font gives it, the face first and its
 * metric-matched fallback after). Undefined when the brand face sets the
 * script on its own.
 */
export const getLocaleFontStyle = (
  locale: Locale,
  brandFamilies: string
): CSSProperties | undefined => {
  const { textFaces = [], companions = [] } =
    scriptTypography[getLocaleDefinition(locale).script];
  if (textFaces.length === 0 && companions.length === 0) return undefined;
  const [brandFace, ...brandFallbacks] = brandFamilies.split(", ");
  return {
    "--font-text": [
      ...textFaces,
      brandFace,
      ...companions,
      ...brandFallbacks,
    ].join(", "),
  } as CSSProperties;
};

const languageNameFaces: Readonly<
  Record<Exclude<LocaleScript, "latin">, string>
> = {
  "latin-vietnamese": vietnameseLanguageName.style.fontFamily,
  cyrillic: cyrillicLanguageName.style.fontFamily,
  devanagari: devanagariLanguageName.style.fontFamily,
};

/**
 * The style every locale's root element sets so that language names in a
 * script the brand face lacks keep their script's face on any page: the name
 * face of each such locale, under the property `languageNameStyle`
 * (`./language-labels`) reads.
 */
export const languageNameFontStyle = Object.fromEntries(
  supportedLocales.flatMap((locale) => {
    const { script } = getLocaleDefinition(locale);
    return script === "latin"
      ? []
      : [
          [
            languageNameFontProperty(locale),
            languageNameFaces[script],
          ] as const,
        ];
  })
) as CSSProperties;
