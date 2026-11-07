import { getLocales } from "expo-localization";
import { type AppLocale, resolveAppLocale } from "./app-locale";

/** The app locale for the device's language preferences. */
export const readDeviceLocale = (): AppLocale =>
  resolveAppLocale(getLocales().map(({ languageTag }) => languageTag));
