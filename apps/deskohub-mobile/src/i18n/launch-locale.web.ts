import { Option } from "effect";
import { loadNativeHandoffRequest } from "../auth/web-native-request-store";
import type { AppLocale } from "./app-locale";
import { readDeviceLocale } from "./device-locale";

/**
 * The locale this page load shows. While the native app's sign-in request is
 * live (the page it opened, or the tab its sign-in email opens), the page
 * shows the app's language, so the email and a new account's saved language
 * follow the app rather than the browser. Otherwise it is the browser's.
 */
export const readLaunchLocale = (): AppLocale =>
  Option.flatMapNullishOr(
    loadNativeHandoffRequest(Date.now()),
    (request) => request.locale
  ).pipe(Option.getOrElse(readDeviceLocale));
