import type * as Playwright from "@playwright/test";
import {
  encodeAuthCallbackReturn,
  readAuthCallbackReturnTo,
  signInAttemptParam,
  signInCallbackReturnParam,
} from "@/features/account/routes";

const callbackPath = "/en-US/auth/callback";
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
 * The shared callback URL grammar: the exact expected origin and path, no
 * fragment, and a query of at most one canonical UUIDv4 `attempt` and one
 * encoded same-origin `return`. Any other parameter name, count, or shape fails
 * closed.
 */
export const isExactCallbackUrlString = (
  rawUrl: string,
  baseOrigin: string
): boolean => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.origin !== baseOrigin || url.pathname !== callbackPath) return false;
  if (url.hash !== "") return false;
  return isCallbackQuery([...url.searchParams.entries()]);
};

export const isExactCallbackUrl = (
  page: Playwright.Page,
  baseOrigin: string
): boolean => {
  try {
    return isExactCallbackUrlString(page.url(), baseOrigin);
  } catch {
    return false;
  }
};

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
