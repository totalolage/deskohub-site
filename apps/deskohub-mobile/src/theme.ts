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
  },
  radius: brandRadius.px,
  spacing: { sm: 8, md: 16, lg: 24 },
  type: {
    title: { fontSize: 36, fontWeight: brandFonts.weights.heading },
    body: { fontSize: 17, fontWeight: brandFonts.weights.body },
  },
} as const;
