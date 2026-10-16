import { getLocalizedPagePath, type Locale } from "@/features/i18n";
import { parseSameOriginPath } from "@/shared/utils/same-origin-path";

/**
 * The sign-in search parameter naming where to continue after signing in.
 * Readers must validate it with `parseSameOriginPath`.
 */
export const signInReturnParam = "returnTo";

/** The magic-link search parameter correlating the callback tab with the tab that sent it. */
export const signInAttemptParam = "attempt";

export const getAccountPath = (locale: Locale) =>
  getLocalizedPagePath(locale, "/[locale]/account");

/**
 * Where a finished sign-in continues: `returnTo` when it is a same-origin
 * path, otherwise the account.
 */
export const getSignInDestination = (
  locale: Locale,
  returnTo: string | null | undefined
) => parseSameOriginPath(returnTo) ?? getAccountPath(locale);

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

/**
 * The magic-link callback, carrying the hand-off attempt and a same-origin
 * `returnTo` when given. Any other `returnTo` is left out.
 */
export const getAuthCallbackPath = (
  locale: Locale,
  {
    attemptId,
    returnTo,
  }: { readonly attemptId?: string; readonly returnTo?: string } = {}
) => {
  const path = `/${locale}/auth/callback`;
  const query = new URLSearchParams();
  if (attemptId !== undefined) query.set(signInAttemptParam, attemptId);
  const returnPath = parseSameOriginPath(returnTo);
  if (returnPath !== undefined) query.set(signInReturnParam, returnPath);
  return query.size === 0 ? path : `${path}?${query}`;
};
