import {
  brandColors,
  brandFontFamilies,
  brandFonts,
  brandFontVariation,
  brandRadius,
} from "@deskohub/brand-tokens";
import { Platform } from "react-native";

const brandFontFamily = Platform.select({
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
  },
  radius: brandRadius.px,
  spacing: { sm: 8, md: 16, lg: 24 },
  type: {
    title: { fontSize: 36, ...brandText(brandFonts.weights.heading) },
    body: { fontSize: 17, ...brandText(brandFonts.weights.body) },
  },
} as const;
