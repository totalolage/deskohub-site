import { createHmac, timingSafeEqual } from "node:crypto";
import { Data, Effect, Schema } from "effect";
import { type Locale, locales } from "@/features/i18n";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  type CheckoutStateKey,
  checkoutStateKeyIdSchema,
  getCheckoutStateKeys,
} from "./checkout-state-token";

export const reservationStatusAccessTokenQueryParam = "statusToken" as const;

const reservationStatusAccessTokenPurpose = "reservation-status-access";
const reservationStatusAccessTokenClaimsSchema = Schema.Struct({
  purpose: Schema.Literal(reservationStatusAccessTokenPurpose),
  version: Schema.Literal(1),
  kid: checkoutStateKeyIdSchema,
  orderId: workspaceReservationIdSchema,
  locale: Schema.Literals(locales),
  issuedAtEpochMilliseconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expiresAtEpochMilliseconds: Schema.Int.check(Schema.isGreaterThan(0)),
});

type ReservationStatusAccessTokenClaims =
  typeof reservationStatusAccessTokenClaimsSchema.Type;

export class ReservationStatusAccessTokenError extends Data.TaggedError(
  "ReservationStatusAccessTokenError"
)<{
  readonly code:
    | "missing-secret"
    | "invalid-secret"
    | "invalid-token"
    | "expired";
  readonly message: string;
  readonly cause?: unknown;
}> {}

type ReservationStatusAccessTokenOptions = {
  readonly keys?: readonly CheckoutStateKey[];
  readonly now?: () => number;
};

const invalidToken = (message: string, cause?: unknown) =>
  new ReservationStatusAccessTokenError({
    code: "invalid-token",
    message,
    cause,
  });

const getKeys = Effect.fn("reservationStatusAccessToken.getKeys")(function* (
  options: ReservationStatusAccessTokenOptions
) {
  return yield* getCheckoutStateKeys({ keys: options.keys }).pipe(
    Effect.mapError(
      (cause) =>
        new ReservationStatusAccessTokenError({
          code:
            cause.code === "missing-secret"
              ? "missing-secret"
              : "invalid-secret",
          message: "Reservation status access token keys are unavailable.",
          cause,
        })
    )
  );
});

const getNow = (options: ReservationStatusAccessTokenOptions) =>
  options.now?.() ?? Date.now();

const signClaims = (encodedClaims: string, key: Buffer) =>
  createHmac("sha256", key)
    .update(`${reservationStatusAccessTokenPurpose}.${encodedClaims}`)
    .digest();

export const createReservationStatusAccessToken = Effect.fn(
  "reservationStatusAccessToken.create"
)(function* (
  input: {
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
    readonly expiresAt: Temporal.Instant;
  },
  options: ReservationStatusAccessTokenOptions = {}
) {
  const [activeKey] = yield* getKeys(options);
  const claims = yield* Schema.decodeUnknownEffect(
    reservationStatusAccessTokenClaimsSchema
  )({
    purpose: reservationStatusAccessTokenPurpose,
    version: 1,
    kid: activeKey.kid,
    orderId: input.orderId,
    locale: input.locale,
    issuedAtEpochMilliseconds: getNow(options),
    expiresAtEpochMilliseconds: input.expiresAt.epochMilliseconds,
  }).pipe(
    Effect.mapError((cause) =>
      invalidToken("Reservation status access token claims are invalid.", cause)
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

export const openReservationStatusAccessToken = Effect.fn(
  "reservationStatusAccessToken.open"
)(function* (
  input: {
    readonly token: string;
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
    readonly now: Temporal.Instant;
  },
  options: ReservationStatusAccessTokenOptions = {}
) {
  const parts = input.token.split(".");
  const [encodedClaims, encodedSignature] = parts;
  if (parts.length !== 2 || !encodedClaims || !encodedSignature) {
    return yield* invalidToken("Reservation status access token is invalid.");
  }

  const claims = yield* Effect.try({
    try: () =>
      JSON.parse(
        Buffer.from(encodedClaims, "base64url").toString("utf8")
      ) as unknown,
    catch: (cause) =>
      invalidToken("Reservation status access token is invalid.", cause),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(reservationStatusAccessTokenClaimsSchema, {
        onExcessProperty: "error",
      })
    ),
    Effect.mapError((cause) =>
      cause instanceof ReservationStatusAccessTokenError
        ? cause
        : invalidToken("Reservation status access token is invalid.", cause)
    )
  );
  const keys = yield* getKeys(options);
  const verificationKey = keys.find((key) => key.kid === claims.kid);
  if (!verificationKey) {
    return yield* invalidToken(
      "Reservation status access token used an unknown key."
    );
  }
  const providedSignature = yield* Effect.try({
    try: () => Buffer.from(encodedSignature, "base64url"),
    catch: (cause) =>
      invalidToken("Reservation status access token is invalid.", cause),
  });
  const expectedSignature = signClaims(encodedClaims, verificationKey.key);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return yield* invalidToken("Reservation status access token is invalid.");
  }

  if (claims.orderId !== input.orderId || claims.locale !== input.locale) {
    return yield* invalidToken(
      "Reservation status access token does not match this reservation."
    );
  }
  if (claims.expiresAtEpochMilliseconds <= input.now.epochMilliseconds) {
    return yield* new ReservationStatusAccessTokenError({
      code: "expired",
      message: "Reservation status access token expired.",
    });
  }

  return claims satisfies ReservationStatusAccessTokenClaims;
});
