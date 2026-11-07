/**
 * Whether text can render in the brand face. Native builds embed the font
 * through the expo-font config plugin in app.json, so it is there at launch.
 */
export const useBrandFontReady = (): boolean => true;
