import { Option } from "effect";

const sentinelOrigin = "https://same-origin-path.invalid";
const maxPathLength = 2048;

const parseAgainstSentinel = Option.liftThrowable(
  (path: string) => new URL(path, sentinelOrigin)
);

/**
 * The path and query of a same-origin URL, or `undefined` for anything a
 * browser could resolve to another origin. Use it before navigating to a
 * caller-supplied destination, such as a return target after sign-in, so the
 * value can't redirect off the site. The fragment is dropped.
 */
export const parseSameOriginPath = (
  value: string | null | undefined
): string | undefined => {
  if (
    value === null ||
    value === undefined ||
    value.length > maxPathLength ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    // Browsers read a backslash as a slash, so `/\evil.example` is protocol
    // relative; control characters are stripped before parsing.
    /[\\\p{Cc}]/u.test(value)
  ) {
    return undefined;
  }

  return parseAgainstSentinel(value).pipe(
    Option.filter((url) => url.origin === sentinelOrigin),
    Option.map((url) => `${url.pathname}${url.search}`),
    Option.getOrUndefined
  );
};
