import { brandColors, brandFonts, brandRadius } from "@deskohub/brand-tokens";

/**
 * The app's colour, radius and type values, named for their role on screen
 * and taken from the shared brand tokens. Text uses the platform's system
 * font and the app ships no font files until the brand face's licence is
 * confirmed to cover app embedding.
 */
export const theme = {
  colors: {
    background: brandColors.navyBlue,
    text: "#ffffff",
    textMuted: brandColors.silver,
    accent: brandColors.sunsetYellow,
    /** A raised area on the background, such as a group of list rows. */
    surface: "rgba(255, 255, 255, 0.06)",
    surfacePressed: "rgba(255, 255, 255, 0.12)",
    /** Hairlines between rows and around raised areas (silver, translucent). */
    border: "rgba(216, 216, 216, 0.24)",
    /** Dims the screen behind a dialog. */
    scrim: "rgba(0, 0, 0, 0.6)",
    danger: brandColors.chileanFire,
    warning: brandColors.sunsetYellow,
    info: brandColors.silver,
  },
  radius: brandRadius.px,
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  /** The smallest tappable size, in points. */
  touchTarget: 44,
  type: {
    title: { fontSize: 36, fontWeight: brandFonts.weights.heading },
    heading: { fontSize: 22, fontWeight: "600" },
    body: { fontSize: 17, fontWeight: brandFonts.weights.body },
    caption: { fontSize: 15, fontWeight: brandFonts.weights.body },
  },
} as const;
