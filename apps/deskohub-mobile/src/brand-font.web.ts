import { brandFonts } from "@deskohub/brand-tokens";
import { useFonts } from "expo-font";

/**
 * Whether text can render: the web loads the brand face at runtime. A failed
 * load still reports ready, and the text falls back to the system fonts.
 */
export const useBrandFontReady = (): boolean => {
  const [loaded, error] = useFonts({
    [brandFonts.appFamily]: require("../assets/fonts/Sculpin.ttf"),
  });
  return loaded || error !== null;
};
