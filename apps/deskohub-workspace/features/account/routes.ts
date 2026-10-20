import { Option } from "effect";
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

/**
 * The sign-in search parameter naming a notice for the card to show above
 * its form; the only notice is `signInNoLongerWaitingNotice`.
 */
export const signInNoticeParam = "notice";

/** The notice for a visitor sent back from a verify page with no sign-in waiting. */
export const signInNoLongerWaitingNotice = "no-longer-waiting";

/** The magic-link search parameter correlating the callback tab with the tab that sent it. */
export const signInAttemptParam = "attempt";

/**
 * The magic-link callback's return target. Better Auth decodes a magic link's
 * `callbackURL` once more before it redirects, which would split a query
 * nested in a plain path, so the callback carries it base64url-encoded.
 */
export const signInCallbackReturnParam = "return";

// Same-origin paths are ASCII, which `btoa` and `atob` take as they are.
const encodeCallbackReturn = Option.liftThrowable((path: string) =>
  btoa(path).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
);

/**
 * The callback's encoding of a return target, as `getAuthCallbackPath` writes
 * it. It encodes any value as is, so validate the target first.
 */
export const encodeAuthCallbackReturn = (path: string): string | undefined =>
  Option.getOrUndefined(encodeCallbackReturn(path));
const decodeCallbackReturn = Option.liftThrowable((value: string) =>
  atob(value.replaceAll("-", "+").replaceAll("_", "/"))
);

/**
 * The same-origin return target a magic-link callback carries, validated
 * again because anyone can craft the URL; `undefined` for anything else.
 */
export const readAuthCallbackReturnTo = (
  value: string | null | undefined
): string | undefined =>
  value === null || value === undefined || !/^[\w-]+$/.test(value)
    ? undefined
    : parseSameOriginPath(Option.getOrUndefined(decodeCallbackReturn(value)));

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

/** The sign-in page query parameter naming why the visitor signs in. */
export const signInPurposeParam = "for";

const signInPurposes = ["reservation", "assistant"] as const;

/**
 * Why a visitor signs in, when a page sends them: `reservation` to see a
 * reservation they were linked to, `assistant` to connect an AI assistant to
 * their account.
 */
export type SignInPurpose = (typeof signInPurposes)[number];

export const parseSignInPurpose = (
  value: string | null | undefined
): SignInPurpose | undefined =>
  signInPurposes.find((purpose) => purpose === value);

/**
 * The sign-in page, continuing to `returnTo` after sign-in when it is a
 * same-origin path. Any other value is left out. A `purpose` tells the
 * visitor why they sign in.
 */
export const getAccountSignInPath = (
  locale: Locale,
  returnTo?: string,
  purpose?: SignInPurpose
) => {
  const path = getLocalizedPagePath(locale, "/[locale]/auth/sign-in");
  const returnPath = parseSameOriginPath(returnTo);
  const query = new URLSearchParams({
    ...(returnPath !== undefined && { [signInReturnParam]: returnPath }),
    ...(purpose && { [signInPurposeParam]: purpose }),
  });
  return query.size ? `${path}?${query}` : path;
};

/**
 * The sign-in page telling the visitor that the sign-in their verify page
 * waited for is gone. Nothing pending means no stored return path, so the
 * new sign-in continues to the account.
 */
export const getNoLongerWaitingSignInPath = (locale: Locale) =>
  `${getAccountSignInPath(locale)}?${new URLSearchParams({
    [signInNoticeParam]: signInNoLongerWaitingNotice,
  })}`;

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
  const encodedReturn =
    returnPath === undefined ? undefined : encodeAuthCallbackReturn(returnPath);
  if (encodedReturn !== undefined) {
    query.set(signInCallbackReturnParam, encodedReturn);
  }
  return query.size === 0 ? path : `${path}?${query}`;
};

/**
 * The page that waits for the sign-in email this tab requested last: the
 * inbox instructions and, while sign-in codes are on, the code entry.
 */
export const getAuthVerifyPath = (locale: Locale) =>
  getLocalizedPagePath(locale, "/[locale]/auth/verify");

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
