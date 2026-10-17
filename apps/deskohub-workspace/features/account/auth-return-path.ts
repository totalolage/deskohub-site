import { Option } from "effect";
import { isLocale } from "@/features/i18n";
import { parseSameOriginPath } from "@/shared/utils/same-origin-path";

/** The query parameter that carries a sign-in's return path. */
export const authReturnPathParam = "returnTo";

// The return path rides inside the sign-in email's link, so it stays short
// enough for mail clients; a sealed checkout blob fits comfortably.
const maximumAuthReturnPathLength = 2048;

const decodePathSegment = Option.liftThrowable(decodeURIComponent);

/**
 * The sign-in callback's return parameter. Better Auth decodes a magic
 * link's `callbackURL` once more before it redirects, which would split a
 * query nested in a plain path, so the path rides base64url-encoded.
 */
export const authCallbackReturnParam = "return";

// Validated return paths are ASCII, which `btoa` and `atob` take as is.
const toBase64Url = Option.liftThrowable((path: string) =>
  btoa(path).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
);
const fromBase64Url = Option.liftThrowable((encoded: string) =>
  atob(encoded.replaceAll("-", "+").replaceAll("_", "/"))
);

/**
 * A validated path a sign-in returns to: a same-origin page on one of the
 * site's locales, outside the auth pages themselves, with its query kept.
 * Anything else, such as another origin, a protocol-relative URL, or a
 * sign-in page that would loop, reads as absent, and the sign-in returns to
 * the account instead.
 */
export const parseAuthReturnPath = (
  candidate: string | null | undefined
): string | undefined => {
  if (
    candidate === null ||
    candidate === undefined ||
    candidate.length > maximumAuthReturnPathLength
  ) {
    return undefined;
  }
  const path = parseSameOriginPath(candidate);
  if (path === undefined) return undefined;
  const [, locale = "", section = ""] = path.replace(/\?.*$/, "").split("/");
  const decodedSection = Option.getOrUndefined(decodePathSegment(section));
  if (
    !isLocale(locale) ||
    decodedSection === undefined ||
    decodedSection.toLowerCase() === "auth"
  ) {
    return undefined;
  }
  return path;
};

/** Appends a return path to an auth page path, when there is one. */
export const withAuthReturnPath = (
  path: string,
  returnPath: string | undefined
) =>
  returnPath === undefined
    ? path
    : `${path}?${new URLSearchParams({ [authReturnPathParam]: returnPath })}`;

/** Encodes a validated return path for the sign-in callback URL. */
export const encodeAuthCallbackReturnPath = (
  path: string
): string | undefined => Option.getOrUndefined(toBase64Url(path));

/**
 * Reads the sign-in callback's return path back, validated again, since the
 * callback URL arrives from the link in the email.
 */
export const readAuthCallbackReturnPath = (
  encoded: string | null | undefined
): string | undefined =>
  encoded === null || encoded === undefined || !/^[\w-]+$/.test(encoded)
    ? undefined
    : parseAuthReturnPath(Option.getOrUndefined(fromBase64Url(encoded)));
