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
  fallback: [
    "Avenir Next",
    "Segoe UI",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
  weights: { heading: 400, subheading: 400, body: 400 },
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

// The site's font loader sets `--font-sculpin` to the loaded brand face.
const webFontStack = [
  "var(--font-sculpin)",
  ...brandFonts.fallback.map((name) =>
    name.includes(" ") ? `"${name}"` : name
  ),
].join(", ");

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
