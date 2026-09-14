import type * as Playwright from "@playwright/test";

const callbackPath = "/en-US/auth/callback";
const attemptParamName = "attempt";
// Canonical lowercase UUIDv4 shape only; production mints the handoff attempt
// parameter in this exact grammar.
const canonicalUuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The shared callback URL grammar: the exact expected origin and path, no
 * fragment, and either no query at all or precisely one canonical UUIDv4
 * `attempt` parameter. Any other parameter name, count, or shape fails closed.
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
  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) return true;
  if (entries.length !== 1 || entries[0] === undefined) return false;
  const [name, value] = entries[0];
  return name === attemptParamName && canonicalUuidV4Pattern.test(value);
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
