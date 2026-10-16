import { createHash } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";

/**
 * Session windows fixed by the security contract: a 30-day rolling lifetime,
 * an at-most-daily refresh age, and a 10-minute freshness requirement for
 * destructive actions. Cookie caching stays disabled so logout, deletion, and
 * server-side revocation act on the next authoritative request.
 */
const betterAuthSessionOptions = {
  expiresIn: 60 * 60 * 24 * 30,
  updateAge: 60 * 60 * 24,
  freshAge: 60 * 10,
  cookieCache: {
    enabled: false,
  },
  storeSessionInDatabase: true,
} as const;

/**
 * SHA-256 in unpadded base64url: the digest Better Auth's `"hashed"` storage
 * mode writes. The magic-link token goes through it before the verification
 * identifier is hashed again, so the stored identifier of a sent link can be
 * recomputed from its token.
 */
export const digestVerificationKey = async (value: string) =>
  createHash("sha256").update(value).digest("base64url");

/**
 * Magic links expire after ten minutes, are consumed atomically on first use,
 * and store only a hash in the verification table. Both magic-link endpoints
 * allow five requests per client IP per ten minutes.
 */
export const betterAuthMagicLinkOptions = {
  expiresIn: 600,
  storeToken: { type: "custom-hasher", hash: digestVerificationKey },
  rateLimit: {
    window: 600,
    max: 5,
  },
} as const;

/**
 * The six-digit sign-in code sent with the magic link lives as long as the
 * link and is stored only as a hash. Five wrong attempts burn it. Its
 * sign-in endpoint allows ten requests per client IP per ten minutes.
 */
export const betterAuthSignInCodeOptions = {
  otpLength: 6,
  expiresIn: betterAuthMagicLinkOptions.expiresIn,
  allowedAttempts: 5,
  storeOTP: "hashed",
  rateLimit: {
    window: 600,
    max: 10,
  },
} as const;

/**
 * While sign-in codes are on, one email address receives at most five
 * sign-in emails per rolling hour, whatever IP addresses ask.
 */
export const signInEmailLimit = {
  window: 60 * 60,
  max: 5,
} as const;

/**
 * Per-IP limits on the passkey endpoints, in line with the sign-in limits.
 * Option generation runs on every sign-in page visit (the email field's
 * passkey autofill), so it allows more requests than the ceremonies that
 * verify or change credentials. No window exceeds the magic-link window the
 * cleanup cron keeps rate-limit rows for.
 */
const betterAuthPasskeyRateLimits = {
  "/passkey/generate-authenticate-options": { window: 600, max: 30 },
  "/passkey/verify-authentication": { window: 600, max: 10 },
  "/passkey/generate-register-options": { window: 600, max: 10 },
  "/passkey/verify-registration": { window: 600, max: 10 },
  "/passkey/update-passkey": { window: 600, max: 20 },
  "/passkey/delete-passkey": { window: 600, max: 20 },
} as const;

/**
 * Connectionless Better Auth options shared between schema generation and the
 * runtime instance. The runtime singleton adds the database adapter, dynamic
 * `baseURL`, secrets, plugins, and lifecycle hooks on top of this object.
 */
export const authOptions = {
  appName: "Deskohub Workspace",
  user: {
    additionalFields: {
      deletionRequestedAt: {
        type: "date",
        required: false,
        input: false,
      },
      // The customer's saved locale preference (en-US or cs-CZ, enforced by
      // a CHECK constraint). Null until account creation seeds it or a
      // sign-in captures it; never defaulted. Server-owned, so clients
      // cannot set it.
      locale: {
        type: "string",
        required: false,
        input: false,
      },
    },
    deleteUser: {
      enabled: true,
    },
  },
  session: betterAuthSessionOptions,
  verification: {
    storeIdentifier: "hashed",
  },
  emailAndPassword: {
    enabled: false,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: betterAuthPasskeyRateLimits,
  },
  advanced: {
    crossSubDomainCookies: {
      enabled: false,
    },
    defaultCookieAttributes: {
      sameSite: "lax",
      path: "/",
    },
    ipAddress: {
      ipAddressHeaders: ["x-vercel-forwarded-for"],
    },
    disableCSRFCheck: false,
    disableOriginCheck: false,
    trustedProxyHeaders: false,
    // Session reads load the user in the same query, so a signed-in
    // request resolves its session, account, and locale preference in one
    // lookup.
    database: {
      joins: true,
    },
  },
} satisfies BetterAuthOptions;
