import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { Schema } from "effect";

/**
 * The Workspace's customer-facing locales. It has its own entry point so the
 * app can name a locale without the HTTP API definitions the package root
 * builds when it loads.
 */
export const CustomerLocale = Schema.Literals(supportedLocales).annotate({
  identifier: "CustomerLocale",
});
export type CustomerLocale = typeof CustomerLocale.Type;

/**
 * The app's locale on the Better Auth requests that can create its account:
 * the sign-in code (`POST /sign-in/email-otp`) and the magic-link
 * verification (`GET /magic-link/verify`). An account they create gets this
 * locale as its saved language, and an account without one gets it at that
 * sign-in; a saved language is never replaced. A localized callback URL, as
 * the site sends, takes precedence. Any value other than a
 * {@link CustomerLocale} is refused with 400 `INVALID_LOCALE` before the code
 * or link is used.
 */
export const customerSignInLocaleHeader = "x-deskohub-locale";
