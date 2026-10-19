import type * as Playwright from "@playwright/test";
import {
  encodeAuthCallbackReturn,
  getAuthCallbackPath,
  readAuthCallbackReturnTo,
  signInAttemptParam,
  signInCallbackReturnParam,
} from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";

const failureParamName = "error";
const invalidTokenFailureValue = "INVALID_TOKEN";
// Canonical lowercase UUIDv4 shape only; production mints the handoff attempt
// parameter in this exact grammar.
const canonicalUuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The callback query production mints: at most one canonical UUIDv4
 * `attempt` and at most one canonical encoded same-origin `return`, nothing
 * else.
 */
const isCallbackQuery = (entries: readonly [string, string][]): boolean => {
  const parameters = new Map(entries);
  if (parameters.size !== entries.length) return false;
  for (const [name, value] of parameters) {
    if (name === signInAttemptParam) {
      if (!canonicalUuidV4Pattern.test(value)) return false;
    } else {
      const returnTo =
        name === signInCallbackReturnParam
          ? readAuthCallbackReturnTo(value)
          : undefined;
      if (
        returnTo === undefined ||
        encodeAuthCallbackReturn(returnTo) !== value
      ) {
        return false;
      }
    }
  }
  return true;
};

/**
 * The callback a magic link lands on: its locale and, when the sign-in
 * started with one, the exact same-origin path and query it returns to.
 */
export type CallbackLanding = {
  readonly locale?: Locale;
  readonly returnTo?: string;
};

/**
 * The exact `return` value the callback must carry for a landing, `null` when
 * the landing names no return target, and `undefined` when the return target
 * has no callback encoding.
 */
export const expectedCallbackReturnValue = ({
  returnTo,
}: CallbackLanding): string | null | undefined =>
  returnTo === undefined ? null : encodeAuthCallbackReturn(returnTo);

/**
 * The shared callback URL grammar: the exact expected origin and the
 * landing's localized callback path (en-US by default), no fragment, and a
 * query of at most one canonical UUIDv4 `attempt` and one encoded same-origin
 * `return`. A landing with a return target requires exactly its encoded
 * `return`. Any other parameter name, count, or shape fails closed.
 */
export const isExactCallbackUrlString = (
  rawUrl: string,
  baseOrigin: string,
  landing: CallbackLanding = {}
): boolean => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (
    url.origin !== baseOrigin ||
    url.pathname !== getAuthCallbackPath(landing.locale ?? "en-US")
  )
    return false;
  if (url.hash !== "") return false;
  if (!isCallbackQuery([...url.searchParams.entries()])) return false;
  const expectedReturn = expectedCallbackReturnValue(landing);
  return (
    expectedReturn === null ||
    (expectedReturn !== undefined &&
      url.searchParams.get(signInCallbackReturnParam) === expectedReturn)
  );
};

export const isExactCallbackUrl = (
  page: Playwright.Page,
  baseOrigin: string,
  landing: CallbackLanding = {}
): boolean => {
  try {
    return isExactCallbackUrlString(page.url(), baseOrigin, landing);
  } catch {
    return false;
  }
};

/**
 * The text of the callback card once this browser is signed in: its status
 * label, its heading, and the body saying where the tab goes next (back to
 * the return target when the landing carries one, otherwise the account).
 */
export const signedInCallbackCopy = ({
  locale = "en-US",
  returnTo,
}: CallbackLanding) => ({
  label: m.accountSignInLoading({}, { locale }),
  title: m.accountCallbackSignedInTitle({}, { locale }),
  body:
    returnTo === undefined
      ? m.accountCallbackSignedInAccount({}, { locale })
      : m.accountCallbackSignedInReturning({}, { locale }),
});

/**
 * The consumed-link failure grammar: the query of the URL Better Auth lands on
 * when a magic link cannot be verified. The callback URL is the redirect
 * target verbatim, so the failure parameter rides alongside the callback
 * query: an optional canonical `attempt` and an optional same-origin
 * `returnTo`. Any other parameter name, count, or shape fails closed.
 */
export const isCallbackFailureQuery = (search: string): boolean => {
  let entries: [string, string][];
  try {
    entries = [...new URLSearchParams(search).entries()];
  } catch {
    return false;
  }
  const failures = entries.filter(([name]) => name === failureParamName);
  if (failures.length !== 1 || failures[0]?.[1] !== invalidTokenFailureValue)
    return false;
  return isCallbackQuery(entries.filter(([name]) => name !== failureParamName));
};
