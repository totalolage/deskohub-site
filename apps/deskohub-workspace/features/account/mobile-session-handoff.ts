import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { Data, Effect, Schema } from "effect";
import {
  checkoutStateClaimsSchema,
  createCheckoutStateClaims,
  openCheckoutState,
  sealCheckoutState,
} from "@/features/checkout/backend/checkout/checkout-state-token";

const handoffTtlMilliseconds = 5 * 60 * 1000;
const sessionCookieName = "__Secure-neon-auth.session_token";
const challengePattern = /^[A-Za-z0-9_-]{43}$/;
const productionScheme = "deskohub-workspace";
const previewSchemePattern = /^deskohub-workspace-preview-p\d+-s[0-9a-f]{8}$/;

const handoffStateSchema = Schema.Struct({
  kid: checkoutStateClaimsSchema.fields.kid,
  iat: checkoutStateClaimsSchema.fields.iat,
  exp: checkoutStateClaimsSchema.fields.exp,
  sessionCookie: Schema.NonEmptyString,
  challenge: Schema.String.check(Schema.isPattern(challengePattern)),
  scheme: Schema.NonEmptyString,
});

export class MobileSessionHandoffError extends Data.TaggedError(
  "MobileSessionHandoffError"
) {}

export const validateMobileAppScheme = (scheme: string) =>
  scheme === productionScheme || previewSchemePattern.test(scheme);

export const getNeonSessionCookie = (cookieHeader: string | null) => {
  if (!cookieHeader) return null;
  const value = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));
  return value && value.length > sessionCookieName.length + 1 ? value : null;
};

export const createMobileSessionHandoff = Effect.fn(
  "account.createMobileSessionHandoff"
)(function* (input: {
  readonly challenge: string;
  readonly scheme: string;
  readonly sessionCookie: string;
}) {
  if (
    !challengePattern.test(input.challenge) ||
    !validateMobileAppScheme(input.scheme) ||
    !getNeonSessionCookie(input.sessionCookie)
  ) {
    return yield* new MobileSessionHandoffError();
  }
  const claims = yield* createCheckoutStateClaims(handoffTtlMilliseconds).pipe(
    Effect.mapError(() => new MobileSessionHandoffError())
  );
  return yield* sealCheckoutState({ ...claims, ...input }, claims.kid).pipe(
    Effect.mapError(() => new MobileSessionHandoffError())
  );
});

export const exchangeMobileSessionHandoff = Effect.fn(
  "account.exchangeMobileSessionHandoff"
)(function* (input: { readonly code: string; readonly verifier: string }) {
  const state = yield* openCheckoutState(input.code, handoffStateSchema).pipe(
    Effect.mapError(() => new MobileSessionHandoffError())
  );
  const actual = createHash("sha256").update(input.verifier).digest();
  const expected = Buffer.from(state.challenge, "base64url");
  if (
    actual.byteLength !== expected.byteLength ||
    !timingSafeEqual(actual, expected)
  ) {
    return yield* new MobileSessionHandoffError();
  }
  return { sessionCookie: state.sessionCookie };
});
