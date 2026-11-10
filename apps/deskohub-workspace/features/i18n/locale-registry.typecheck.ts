import type { SupportedLocale } from "@deskohub/i18n/locale-registry";
import type { Locale } from "./paraglide/runtime.js";

/**
 * Paraglide generates `Locale` from the customer Inlang project's settings,
 * and Workspace code passes it where the locale registry's `SupportedLocale`
 * is expected, so the project must serve exactly the registry's locales.
 */
type IsSameType<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type AssertTrue<Value extends true> = Value;

export type CustomerLocaleIsSupportedLocale = AssertTrue<
  IsSameType<Locale, SupportedLocale>
>;
