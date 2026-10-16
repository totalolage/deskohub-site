import { getLocalizedPagePath, type Locale } from "@/features/i18n";
import { parseSameOriginPath } from "@/shared/utils/same-origin-path";

/**
 * The sign-in search parameter naming where to continue after signing in.
 * Readers must validate it with `parseSameOriginPath`.
 */
export const signInReturnParam = "returnTo";

export const getAccountPath = (locale: Locale) =>
  getLocalizedPagePath(locale, "/[locale]/account");

/**
 * The sign-in page, continuing to `returnTo` after sign-in when it is a
 * same-origin path. Any other value is left out.
 */
export const getAccountSignInPath = (locale: Locale, returnTo?: string) => {
  const path = getLocalizedPagePath(locale, "/[locale]/auth/sign-in");
  const returnPath = parseSameOriginPath(returnTo);
  return returnPath === undefined
    ? path
    : `${path}?${new URLSearchParams({ [signInReturnParam]: returnPath })}`;
};
