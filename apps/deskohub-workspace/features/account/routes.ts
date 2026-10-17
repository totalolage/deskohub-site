import {
  type AccountSection,
  defaultAccountSection,
  isAccountSection,
} from "@/features/account/sections";
import {
  getLocalizedDynamicPagePath,
  getLocalizedPagePath,
  type Locale,
} from "@/features/i18n";
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

export const getAccountSectionPath = (
  locale: Locale,
  section: AccountSection
) =>
  section === "legal"
    ? getLocalizedPagePath(locale, "/[locale]/account/legal")
    : getLocalizedDynamicPagePath(locale, "/[locale]/account/[section]", {
        section,
      });

const withoutTrailingSlashes = (pathname: string) =>
  pathname.replace(/\/+$/, "");

/** Whether a pathname is the bare account path, without a section. */
export const isAccountPathname = (locale: Locale, pathname: string) =>
  withoutTrailingSlashes(pathname) === getAccountPath(locale);

/**
 * The section an account pathname shows: the default section on the bare
 * account path, nothing outside the sections (such as the deleted page).
 */
export const findAccountSectionOfPathname = (
  locale: Locale,
  pathname: string
): AccountSection | undefined => {
  if (isAccountPathname(locale, pathname)) return defaultAccountSection;
  const accountPath = getAccountPath(locale);
  const normalizedPathname = withoutTrailingSlashes(pathname);
  if (!normalizedPathname.startsWith(`${accountPath}/`)) return undefined;

  const segment = normalizedPathname.slice(accountPath.length + 1);
  return isAccountSection(segment) ? segment : undefined;
};

const legacySectionParam = "section";

/**
 * Where a retired `/[locale]/account?section=<section>` link now leads: the
 * section's own path, or the account itself for an unknown section. Other
 * query parameters stay. Any other URL has no redirect.
 */
export const findLegacyAccountSectionRedirect = (
  locale: Locale,
  url: URL
): URL | undefined => {
  if (
    withoutTrailingSlashes(url.pathname) !== getAccountPath(locale) ||
    !url.searchParams.has(legacySectionParam)
  ) {
    return undefined;
  }

  const section = url.searchParams.get(legacySectionParam) ?? "";
  const redirectUrl = new URL(url);
  redirectUrl.searchParams.delete(legacySectionParam);
  redirectUrl.pathname = isAccountSection(section)
    ? getAccountSectionPath(locale, section)
    : getAccountPath(locale);
  return redirectUrl;
};
