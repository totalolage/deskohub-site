const parserOrigin = "https://same-origin.invalid";
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/;
const encodedPathSeparatorPattern = /%2f|%5c/i;

/**
 * Reads an untrusted redirect target as a path on this site: a root-relative
 * path with an optional query, returned normalized (dot segments resolved,
 * fragment dropped). Absolute, protocol-relative (`//host`), backslash, and
 * encoded-separator forms, which browsers or routers may resolve to another
 * origin or path, read as absent.
 */
export const parseSameOriginPath = (
  candidate: string | null | undefined
): string | undefined => {
  if (
    !candidate?.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    controlCharacterPattern.test(candidate)
  ) {
    return undefined;
  }
  const url = URL.parse(candidate, parserOrigin);
  if (url === null || url.origin !== parserOrigin) return undefined;
  if (encodedPathSeparatorPattern.test(url.pathname)) return undefined;
  return `${url.pathname}${url.search}`;
};
