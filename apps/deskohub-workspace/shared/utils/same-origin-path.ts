import { Option } from "effect";

const sentinelOrigin = "https://same-origin-path.invalid";
/**
 * The longest path a same-origin destination may have. It fits a sign-in
 * return path carrying sealed checkout state, which a magic link carries
 * base64url-encoded, a third longer, under the 14 KB URL limit of Vercel's
 * CDN.
 */
export const maxSameOriginPathLength = 8 * 1024;

const parseAgainstSentinel = Option.liftThrowable(
  (path: string) => new URL(path, sentinelOrigin)
);

/**
 * Whether a browser keeps `path` on the current origin. `//` is protocol
 * relative, browsers read a backslash as a slash, and control characters are
 * stripped before parsing.
 */
const isRootRelative = (path: string) =>
  path.startsWith("/") && !path.startsWith("//") && !/[\\\p{Cc}]/u.test(path);

/**
 * The normalized path and query of a same-origin URL, or `undefined` for
 * anything a browser could resolve to another origin. Use it before
 * navigating to a caller-supplied destination, such as a return target after
 * sign-in, so the value can't redirect off the site. The fragment is dropped.
 */
export const parseSameOriginPath = (
  value: string | null | undefined
): string | undefined => {
  if (
    value === null ||
    value === undefined ||
    value.length > maxSameOriginPathLength ||
    !isRootRelative(value)
  ) {
    return undefined;
  }

  return parseAgainstSentinel(value).pipe(
    Option.filter((url) => url.origin === sentinelOrigin),
    Option.map((url) => `${url.pathname}${url.search}`),
    // Resolving dot segments can leave a protocol-relative path, as
    // `/x/..//evil.example` becomes `//evil.example`, so check the result too.
    Option.filter(isRootRelative),
    Option.getOrUndefined
  );
};
