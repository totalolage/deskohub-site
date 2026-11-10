import {
  brandColors,
  brandFontFamilies,
  brandFonts,
  brandFontVariation,
  brandRadius,
} from "@deskohub/brand-tokens";
import { Platform } from "react-native";

/** The brand face's family name on this platform. */
export const brandFontFamily = Platform.select({
  web: brandFontFamilies.web,
  default: brandFontFamilies.native,
});

type BrandWeight = (typeof brandFonts.weights)[keyof typeof brandFonts.weights];

const brandText = (weight: BrandWeight) => ({
  fontFamily: brandFontFamily,
  fontWeight: weight,
  fontVariationSettings: brandFontVariation(weight),
});

/**
 * The app's colour, radius and type values, named for their role on screen
 * and taken from the shared brand tokens. Text uses the brand face, which
 * native builds embed and the web loads before the first screen renders.
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
    title: { fontSize: 36, ...brandText(brandFonts.weights.heading) },
    heading: { fontSize: 22, ...brandText(brandFonts.weights.emphasis) },
    body: { fontSize: 17, ...brandText(brandFonts.weights.body) },
    bodyStrong: { fontSize: 17, ...brandText(brandFonts.weights.emphasis) },
    caption: { fontSize: 15, ...brandText(brandFonts.weights.body) },
    captionStrong: { fontSize: 15, ...brandText(brandFonts.weights.emphasis) },
  },
} as const;
