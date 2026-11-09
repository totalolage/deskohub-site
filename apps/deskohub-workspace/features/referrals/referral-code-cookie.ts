import {
  parseReferralCode,
  type ReferralCode,
  referralCodeQueryParam,
} from "./client";
import { sharedReferralCodeRememberedDays } from "./program";

/**
 * First-party cookie remembering the referral code from the first shared
 * link this browser opened. It is strictly necessary: it only applies a
 * discount the visitor asked for. Readable by the browser so checkout and
 * profile completion can prefill it.
 */
export const referralCodeCookieName = "deskohub-referral-code";

const maxAgeSeconds = sharedReferralCodeRememberedDays * 24 * 60 * 60;

/** Syntactic check only; usability is decided where the code is used. */
export const parseSharedReferralCode = (
  value: string | null | undefined
): ReferralCode | undefined => parseReferralCode(value?.trim().toUpperCase());

type ReferralCodeCookieOptions = {
  readonly path: string;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly maxAge: number;
  readonly httpOnly: false;
};

type CookieJar = {
  readonly has: (name: string) => boolean;
  readonly set: (
    name: string,
    value: string,
    options: ReferralCodeCookieOptions
  ) => unknown;
};

const cookieOptions = (
  secure: boolean,
  maxAge: number
): ReferralCodeCookieOptions => ({
  path: "/",
  sameSite: "lax",
  secure,
  maxAge,
  httpOnly: false,
});

/**
 * The code a page address carries, when this browser remembers none yet. The
 * page being shown decides with this. First wins is best-effort: two
 * simultaneous first visits with different codes each set the cookie, and the
 * browser keeps whichever it applies last. Only the code's shape is checked.
 */
export const findSharedReferralCodeToRemember = (
  searchParams: URLSearchParams,
  cookies: Pick<CookieJar, "has">
) =>
  cookies.has(referralCodeCookieName)
    ? undefined
    : parseSharedReferralCode(searchParams.get(referralCodeQueryParam));

export const setReferralCodeCookie = (
  cookies: Pick<CookieJar, "set">,
  code: ReferralCode,
  secure: boolean
) =>
  cookies.set(
    referralCodeCookieName,
    code,
    cookieOptions(secure, maxAgeSeconds)
  );

/**
 * Expires the remembered code once it is used: the referral was recorded or
 * the customer's first paid booking made it moot.
 */
export const clearReferralCodeCookie = (
  cookies: Pick<CookieJar, "set">,
  secure: boolean
) => cookies.set(referralCodeCookieName, "", cookieOptions(secure, 0));

/**
 * The browser's own cookies, for client components that remember or forget
 * the code. It writes the same name and attributes the server sets.
 */
export const browserCookieJar: CookieJar = {
  has: (name) =>
    document.cookie
      .split(";")
      .some((cookie) => cookie.trim().startsWith(`${name}=`)),
  set: (name, value, options) => {
    // biome-ignore lint/suspicious/noDocumentCookie: The remembered code is a first-party, non-HttpOnly cookie shared with the server.
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=${options.path}; Max-Age=${options.maxAge}; SameSite=Lax${options.secure ? "; Secure" : ""}`;
  },
};
