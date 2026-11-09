import { type SignInMethod, signInMethods } from "../analytics/events";

/**
 * The sign-in callback the app receives, either as the `/app/auth/callback`
 * App Link (a magic link opened from a mail app) or as the
 * `deskohub://auth/callback` return of the in-app auth session (a handoff
 * code the web sign-in page minted). The route at `app/auth/callback.tsx`
 * owns both; `app/+native-intent.ts` maps the App Link's `/app/auth/callback`
 * to it, since Expo Router applies its `/app` base URL only on web.
 */
export type AuthCallback =
  | { readonly kind: "token"; readonly token: string }
  | {
      readonly kind: "handoff";
      readonly code: string;
      readonly state: string;
      /** How the web page signed in, for analytics; never trusted for auth. */
      readonly method?: SignInMethod;
    }
  | { readonly kind: "error"; readonly code: string }
  | { readonly kind: "invalid" };

/** The search param the web page adds to a minted handoff URL. */
export const signInMethodParam = "method";

const isSignInMethod = (
  value: string | null | undefined
): value is SignInMethod => signInMethods.some((method) => method === value);

/** Where the web sign-in page sends a minted handoff code. */
export const nativeReturnUri = "deskohub://auth/callback";

/** The callback's path on the web bundle, under Expo's `/app` base URL. */
export const webCallbackPath = "/app/auth/callback";

const invalid: AuthCallback = { kind: "invalid" };

// Better Auth error codes and OAuth-style error names; anything else is
// reduced to a fixed code so a crafted link can't put text on screen.
const errorCodePattern = /^[A-Za-z0-9_-]{1,64}$/;

/** The values one search parameter took: none, one, or several. */
type ParamValues = ReadonlyArray<string>;

const single = (values: ParamValues): string | undefined | null => {
  if (values.length === 0) return undefined;
  if (values.length > 1) return null;
  return values[0] === "" ? null : values[0];
};

const fromParamValues = (read: (name: string) => ParamValues): AuthCallback => {
  const error = read("error");
  if (error.length > 0) {
    const value = single(error);
    return {
      kind: "error",
      code:
        typeof value === "string" && errorCodePattern.test(value)
          ? value
          : "unknown",
    };
  }
  const token = single(read("token"));
  const code = single(read("code"));
  const state = single(read("state"));
  if (token === null || code === null || state === null) return invalid;
  if (token !== undefined) {
    return code === undefined && state === undefined
      ? { kind: "token", token }
      : invalid;
  }
  if (code !== undefined && state !== undefined) {
    const method = single(read(signInMethodParam));
    return isSignInMethod(method)
      ? { kind: "handoff", code, state, method }
      : { kind: "handoff", code, state };
  }
  return invalid;
};

const isCallbackLocation = (url: URL): boolean => {
  if (url.protocol === "https:") return url.pathname === webCallbackPath;
  if (url.protocol !== "deskohub:") return false;
  // `deskohub://auth/callback` parses with `auth` as the host.
  return (
    (url.host === "auth" && url.pathname === "/callback") ||
    (url.host === "" && url.pathname === "/auth/callback")
  );
};

/** Reads a full callback URL, such as an auth session's return URL. */
export const parseAuthCallbackUrl = (value: string): AuthCallback => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid;
  }
  if (!isCallbackLocation(url)) return invalid;
  return fromParamValues((name) => url.searchParams.getAll(name));
};

/** Reads the search params Expo Router hands the callback route. */
export const parseAuthCallbackParams = (
  params: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>
): AuthCallback =>
  fromParamValues((name) => {
    const value = params[name];
    if (value === undefined) return [];
    return typeof value === "string" ? [value] : value;
  });

/** The minted handoff URL with the method the page signed in with. */
export const withSignInMethod = (url: string, method: SignInMethod): string => {
  const withMethod = new URL(url);
  withMethod.searchParams.set(signInMethodParam, method);
  return withMethod.toString();
};
