/**
 * Deskohub brand tokens shared by the Workspace site, whose CSS reads them as
 * the `brand-theme.css` variables, and the mobile app's theme.
 */

/** Brand colours as hex. Each `*Ink` colour is the text tone of its base. */
export const brandColors = {
  navyBlue: "#00024f",
  silver: "#d8d8d8",
  sunsetYellow: "#eca423",
  sunsetYellowInk: "#8a5d00",
  chileanFire: "#f57c00",
  burnedOrange: "#b83b06",
  burnedOrangeInk: "#7a2e0a",
  aquamarineGreen: "#00df99",
  aquamarineInk: "#004c3b",
} as const;

export type BrandColor = keyof typeof brandColors;

/**
 * Corner radii. The web scales `rem` with the root font size; `px` gives the
 * same corners at the default 16px root: `lg` is the base radius, `md` and
 * `sm` are 2px and 4px tighter.
 */
export const brandRadius = {
  rem: 0.65,
  px: { sm: 6.4, md: 8.4, lg: 10.4 },
} as const;

/**
 * The brand typeface and the system fonts that stand in until it loads or
 * where it isn't available. Every text role uses the same family.
 */
export const brandFonts = {
  family: "Sculpin",
  /**
   * The family name the brand font file declares. iOS registers an embedded
   * font under that name, so the app names the face this on every platform.
   */
  appFamily: "Sculpin Variable",
  fallback: [
    "Avenir Next",
    "Segoe UI",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
  weights: { heading: 400, subheading: 400, body: 400, emphasis: 600 },
} as const;

const brandColorVariables = {
  navyBlue: "--brand-navy-blue",
  silver: "--brand-silver",
  sunsetYellow: "--brand-sunset-yellow",
  sunsetYellowInk: "--brand-sunset-yellow-ink",
  chileanFire: "--brand-chilean-fire",
  burnedOrange: "--brand-burned-orange",
  burnedOrangeInk: "--brand-burned-orange-ink",
  aquamarineGreen: "--brand-aquamarine-green",
  aquamarineInk: "--brand-aquamarine-ink",
} as const satisfies Record<BrandColor, `--brand-${string}`>;

/** A CSS `font-family` list, quoting the names that hold a space. */
const cssFontFamilyList = (families: readonly string[]): string =>
  families.map((name) => (name.includes(" ") ? `"${name}"` : name)).join(", ");

// The site's font loader sets `--font-sculpin` to the loaded brand face, and
// a page whose script the brand face can't set names its own text stack in
// `--font-text`.
const webFontStack = `var(--font-text, var(--font-sculpin)), ${cssFontFamilyList(brandFonts.fallback)}`;

/**
 * The app's `fontFamily` style values. Native text takes one family and the
 * platform's system font draws it when the app has no face of that name; the
 * web takes a CSS list that ends in the system fonts.
 */
export const brandFontFamilies = {
  native: brandFonts.appFamily,
  web: cssFontFamilyList([brandFonts.appFamily, ...brandFonts.fallback]),
} as const;

/**
 * The `fontVariationSettings` style value that draws the variable brand face
 * at `weight`. Without it, native text gets the file's default weight, 300.
 */
export const brandFontVariation = (weight: number): string =>
  `'wght' ${weight}`;

/**
 * The `:root` custom properties `brand-theme.css` declares, by name. The
 * package's test holds the stylesheet to exactly these values.
 */
export const brandThemeVariables: Readonly<
  Partial<Record<`--${string}`, string>>
> = {
  ...Object.fromEntries(
    Object.entries(brandColorVariables).map(([color, variable]) => [
      variable,
      brandColors[color as BrandColor],
    ])
  ),
  "--font-heading": webFontStack,
  "--font-subheading": webFontStack,
  "--font-body": webFontStack,
  "--font-heading-weight": String(brandFonts.weights.heading),
  "--font-subheading-weight": String(brandFonts.weights.subheading),
  "--font-body-weight": String(brandFonts.weights.body),
  "--radius": `${brandRadius.rem}rem`,
};
