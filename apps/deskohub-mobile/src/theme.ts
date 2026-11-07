/**
 * The app's only colour, radius and type values. Screens use the semantic
 * `theme` names; the brand block below mirrors the `@deskohub/brand-tokens`
 * exports (`brandColors`, `brandRadius`, `brandFonts`) so it can become that
 * import without touching any screen. Text uses the system font, so the app
 * ships no font files.
 */
const brandColors = {
  navyBlue: "#00024f",
  silver: "#d8d8d8",
  sunsetYellow: "#eca423",
} as const;

const brandRadius = {
  px: { sm: 6.4, md: 8.4, lg: 10.4 },
} as const;

const brandFonts = {
  weights: { heading: 400, body: 400 },
} as const;

export const theme = {
  colors: {
    background: brandColors.navyBlue,
    text: "#ffffff",
    textMuted: brandColors.silver,
    accent: brandColors.sunsetYellow,
  },
  radius: brandRadius.px,
  spacing: { sm: 8, md: 16, lg: 24 },
  type: {
    title: { fontSize: 36, fontWeight: brandFonts.weights.heading },
    body: { fontSize: 17, fontWeight: brandFonts.weights.body },
  },
} as const;
