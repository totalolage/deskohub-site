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
    };

/** The part of Better Auth's `useSession()` result the state reads. */
export interface SessionSnapshot {
  readonly data:
    | {
        readonly user: AuthUser;
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
    return {
      status: "signed-in",
      user: { id: data.user.id, email: data.user.email },
      signedInAt: new Date(data.session.createdAt),
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

/** An in-app route to return to after signing in, or home. */
export const safeReturnPath = (
  value: string | ReadonlyArray<string> | undefined
): string => {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\") || authRoutes.has(value)) return "/";
  return value;
};
