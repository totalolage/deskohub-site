import {
  type CustomerLocale,
  customerSignInLocaleHeader,
} from "@deskohub/workspace-customer-api/customer-locale";
import { Context } from "effect";
import type { AppLocale } from "../i18n/app-locale";

/**
 * The headers that name the app's locale on a request that can create its
 * account: the sign-in code and the magic-link verification. `/app/` paths
 * carry no locale segment, so a new account takes its saved language from
 * these; an account that has one keeps it.
 */
export const signInLocaleHeaders = (
  locale: AppLocale
): Record<string, string> => ({
  [customerSignInLocaleHeader]: locale satisfies CustomerLocale,
});

/**
 * The locale the app shows, for the native sign-in flows. Each screen
 * provides its `AppLocaleProvider` value to the task it runs, so a sign-in
 * names the language on screen.
 */
export class SignInLocale extends Context.Service<SignInLocale, AppLocale>()(
  "deskohub-mobile/SignInLocale"
) {}
