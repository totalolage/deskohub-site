import { createHmac, timingSafeEqual } from "node:crypto";
import { Data, Effect, Schema } from "effect";
import {
  type CheckoutStateKey,
  checkoutStateKeyIdSchema,
  getCheckoutStateKeys,
} from "@/features/checkout/backend/checkout/checkout-state-token";
import { type Locale, locales } from "@/features/i18n";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";

export const reservationAccessTokenQueryParam = "accessToken" as const;

const reservationAccessTokenPurpose = "reservation-access";
const reservationAccessTokenClaimsSchema = Schema.Struct({
  purpose: Schema.Literal(reservationAccessTokenPurpose),
  version: Schema.Literal(1),
  kid: checkoutStateKeyIdSchema,
  orderId: workspaceReservationIdSchema,
  locale: Schema.Literals(locales),
  issuedAtEpochMilliseconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expiresAtEpochMilliseconds: Schema.Int.check(Schema.isGreaterThan(0)),
});

type ReservationAccessTokenClaims =
  typeof reservationAccessTokenClaimsSchema.Type;

export class ReservationAccessTokenError extends Data.TaggedError(
  "ReservationAccessTokenError"
)<{
  readonly code:
    | "missing-secret"
    | "invalid-secret"
    | "invalid-token"
    | "expired";
  readonly message: string;
  readonly cause?: unknown;
}> {}

type ReservationAccessTokenOptions = {
  readonly keys?: readonly CheckoutStateKey[];
  readonly now?: () => number;
};

const invalidToken = (message: string, cause?: unknown) =>
  new ReservationAccessTokenError({
    code: "invalid-token",
    message,
    cause,
  });

const getKeys = Effect.fn("reservationAccessToken.getKeys")(function* (
  options: ReservationAccessTokenOptions
) {
  return yield* getCheckoutStateKeys({ keys: options.keys }).pipe(
    Effect.mapError(
      (cause) =>
        new ReservationAccessTokenError({
          code:
            cause.code === "missing-secret"
              ? "missing-secret"
              : "invalid-secret",
          message: "Reservation access token keys are unavailable.",
          cause,
        })
    )
  );
});

const getNow = (options: ReservationAccessTokenOptions) =>
  options.now?.() ?? Date.now();

const signClaims = (encodedClaims: string, key: Buffer) =>
  createHmac("sha256", key)
    .update(`${reservationAccessTokenPurpose}.${encodedClaims}`)
    .digest();

export const createReservationAccessToken = Effect.fn(
  "reservationAccessToken.create"
)(function* (
  input: {
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
    readonly expiresAt: Temporal.Instant;
  },
  options: ReservationAccessTokenOptions = {}
) {
  const [activeKey] = yield* getKeys(options);
  const claims = yield* Schema.decodeUnknownEffect(
    reservationAccessTokenClaimsSchema
  )({
    purpose: reservationAccessTokenPurpose,
    version: 1,
    kid: activeKey.kid,
    orderId: input.orderId,
    locale: input.locale,
    issuedAtEpochMilliseconds: getNow(options),
    expiresAtEpochMilliseconds: input.expiresAt.epochMilliseconds,
  }).pipe(
    Effect.mapError((cause) =>
      invalidToken("Reservation access token claims are invalid.", cause)
    )
  );
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString(
    "base64url"
  );
  const signature = signClaims(encodedClaims, activeKey.key).toString(
    "base64url"
  );

  return `${encodedClaims}.${signature}`;
});

export const openReservationAccessToken = Effect.fn(
  "reservationAccessToken.open"
)(function* (
  input: {
    readonly token: string;
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
    readonly now: Temporal.Instant;
  },
  options: ReservationAccessTokenOptions = {}
) {
  const parts = input.token.split(".");
  const [encodedClaims, encodedSignature] = parts;
  if (parts.length !== 2 || !encodedClaims || !encodedSignature) {
    return yield* invalidToken("Reservation access token is invalid.");
  }

  const claims = yield* Effect.try({
    try: () =>
      JSON.parse(
        Buffer.from(encodedClaims, "base64url").toString("utf8")
      ) as unknown,
    catch: (cause) =>
      invalidToken("Reservation access token is invalid.", cause),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(reservationAccessTokenClaimsSchema, {
        onExcessProperty: "error",
      })
    ),
    Effect.mapError((cause) =>
      cause instanceof ReservationAccessTokenError
        ? cause
        : invalidToken("Reservation access token is invalid.", cause)
    )
  );
  const keys = yield* getKeys(options);
  const verificationKey = keys.find((key) => key.kid === claims.kid);
  if (!verificationKey) {
    return yield* invalidToken("Reservation access token used an unknown key.");
  }
  const providedSignature = yield* Effect.try({
    try: () => Buffer.from(encodedSignature, "base64url"),
    catch: (cause) =>
      invalidToken("Reservation access token is invalid.", cause),
  });
  const expectedSignature = signClaims(encodedClaims, verificationKey.key);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return yield* invalidToken("Reservation access token is invalid.");
  }

  if (claims.orderId !== input.orderId || claims.locale !== input.locale) {
    return yield* invalidToken(
      "Reservation access token does not match this reservation."
    );
  }
  if (claims.expiresAtEpochMilliseconds <= input.now.epochMilliseconds) {
    return yield* new ReservationAccessTokenError({
      code: "expired",
      message: "Reservation access token expired.",
    });
  }

  return claims satisfies ReservationAccessTokenClaims;
});
