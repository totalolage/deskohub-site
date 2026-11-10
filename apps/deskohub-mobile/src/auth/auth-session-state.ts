import { isSupportedLocale } from "@deskohub/i18n/locale-registry";
import { Option } from "effect";
import type { AppLocale } from "../i18n/app-locale";

/** The signed-in customer as the app needs it. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
}

/**
 * Where the app's session stands. `restoring` covers the first read after a
 * launch, before the stored cookie (native) or the site cookie (web) has been
 * checked; routes wait on it instead of flashing the sign-in screen.
 */
export type AuthSessionState =
  | { readonly status: "restoring" }
  | { readonly status: "signed-out" }
  | {
      readonly status: "signed-in";
      readonly user: AuthUser;
      readonly signedInAt: Date;
      /**
       * The language the account saved, when the app is translated into it.
       * Absent when the account saved none or one this app version lacks.
       */
      readonly locale?: AppLocale;
    };

/** The part of Better Auth's `useSession()` result the state reads. */
export interface SessionSnapshot {
  readonly data:
    | {
        readonly user: AuthUser & {
          /** The server sends any saved tag, also ones newer than the app. */
          readonly locale?: string | null | undefined;
        };
        readonly session: { readonly createdAt: Date | string };
      }
    | null
    | undefined;
  readonly isPending: boolean;
}

export const toAuthSessionState = ({
  data,
  isPending,
}: SessionSnapshot): AuthSessionState => {
  if (data !== null && data !== undefined) {
    const { locale } = data.user;
    return {
      status: "signed-in",
      user: { id: data.user.id, email: data.user.email },
      signedInAt: new Date(data.session.createdAt),
      ...(typeof locale === "string" && isSupportedLocale(locale)
        ? { locale }
        : {}),
    };
  }
  return isPending ? { status: "restoring" } : { status: "signed-out" };
};

/**
 * The server treats a session as fresh for ten minutes after sign-in. A
 * minute of that is left for the request that needs it.
 */
const freshSignInWindowMs = 9 * 60 * 1000;

export const isFreshSignIn = (signedInAt: Date, now: number): boolean =>
  now - signedInAt.getTime() < freshSignInWindowMs;

const reauthenticationCodes = new Set(["SESSION_NOT_FRESH", "SESSION_EXPIRED"]);

/**
 * Whether a Better Auth error asks for a new sign-in before the action can
 * run: `403 SESSION_NOT_FRESH` (adding a passkey) or `SESSION_EXPIRED`
 * (deleting the account).
 */
export const isReauthenticationRequired = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string" &&
  reauthenticationCodes.has(error.code);

const authRoutes = new Set(["/sign-in", "/auth/callback"]);

/** Only resolves relative paths; never requested. */
const pathBase = "https://app.invalid";
const parsePath = Option.liftThrowable(
  (value: string) => new URL(value, pathBase)
);

/**
 * ASCII control characters, whitespace and backslashes. Other characters
 * outside ASCII are percent-encoded when parsed, so they fail the round trip.
 */
const hasUnsafeCharacter = (value: string): boolean =>
  Array.from(value).some(
    (character) =>
      character <= " " || character === "\x7f" || character === "\\"
  );

/**
 * Whether `value` is an in-app route to return to after signing in: a
 * router path such as `/account?tab=x`, which the router keeps under the
 * app's `/app` base, so a valid one can't leave the app. It must resolve to
 * itself on its own origin, which refuses schemes, `//host`, dot segments and
 * characters browsers strip or rewrite (a tab in `/\t/host` leaves
 * `//host`), and it must not lead back into sign-in.
 */
export const isSafeReturnPath = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.startsWith("/")) return false;
  if (value.startsWith("//") || hasUnsafeCharacter(value)) return false;
  return Option.exists(
    parsePath(value),
    (url) =>
      url.origin === pathBase &&
      `${url.pathname}${url.search}${url.hash}` === value &&
      // The router collapses repeated slashes, so `/auth//callback` would
      // still reach sign-in.
      !url.pathname.includes("//") &&
      !authRoutes.has(url.pathname.replace(/\/+$/, ""))
  );
};

/** An in-app route to return to after signing in, or home. */
export const safeReturnPath = (
  value: string | ReadonlyArray<string> | undefined
): string => (isSafeReturnPath(value) ? value : "/");
