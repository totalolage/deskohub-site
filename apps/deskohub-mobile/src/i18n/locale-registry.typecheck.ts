import type { SupportedLocale } from "@deskohub/i18n/locale-registry";
import type { AppLocale } from "./app-locale";

/**
 * Paraglide generates the app's locale type from its Inlang project's
 * settings, and app code passes it where the locale registry's
 * `SupportedLocale` is expected, so the project must serve exactly the
 * registry's locales.
 */
type IsSameType<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type AssertTrue<Value extends true> = Value;

export type AppLocaleIsSupportedLocale = AssertTrue<
  IsSameType<AppLocale, SupportedLocale>
>;
