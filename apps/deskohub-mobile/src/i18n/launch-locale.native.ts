import type { AppLocale } from "./app-locale";
import { readDeviceLocale } from "./device-locale";

/** The locale the app shows: the device's (or the app's own) language. */
export const readLaunchLocale = (): AppLocale => readDeviceLocale();
