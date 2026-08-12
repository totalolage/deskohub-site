import { createHmac, timingSafeEqual } from "node:crypto";
import { Config, Data, Effect, Redacted, Schema } from "effect";
import { type Locale, locales } from "@/features/i18n";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";

export const reservationStatusAccessTokenQueryParam = "statusToken" as const;

const reservationStatusAccessTokenPurpose = "reservation-status-access";
const minimumSecretLength = 32;

const reservationStatusAccessTokenClaimsSchema = Schema.Struct({
  purpose: Schema.Literal(reservationStatusAccessTokenPurpose),
  version: Schema.Literal(1),
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
  readonly secret?: string;
  readonly now?: () => number;
};

const invalidToken = (message: string, cause?: unknown) =>
  new ReservationStatusAccessTokenError({
    code: "invalid-token",
    message,
    cause,
  });

const getSecret = Effect.fn("reservationStatusAccessToken.getSecret")(
  function* (options: ReservationStatusAccessTokenOptions) {
    const secret =
      options.secret ??
      (yield* Config.redacted("CHECKOUT_RETURN_STATE_TOKEN_SECRET").pipe(
        Effect.map(Redacted.value),
        Effect.mapError(
          (cause) =>
            new ReservationStatusAccessTokenError({
              code: "missing-secret",
              message: "Reservation status access token secret is missing.",
              cause,
            })
        )
      ));

    if (secret.length < minimumSecretLength) {
      return yield* new ReservationStatusAccessTokenError({
        code: "invalid-secret",
        message: "Reservation status access token secret is too short.",
      });
    }

    return secret;
  }
);

const getNow = (options: ReservationStatusAccessTokenOptions) =>
  options.now?.() ?? Date.now();

const signClaims = (encodedClaims: string, secret: string) =>
  createHmac("sha256", secret)
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
  const secret = yield* getSecret(options);
  const claims = yield* Schema.decodeUnknownEffect(
    reservationStatusAccessTokenClaimsSchema
  )({
    purpose: reservationStatusAccessTokenPurpose,
    version: 1,
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
  const signature = signClaims(encodedClaims, secret).toString("base64url");

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
  const secret = yield* getSecret(options);
  const parts = input.token.split(".");
  const [encodedClaims, encodedSignature] = parts;
  if (parts.length !== 2 || !encodedClaims || !encodedSignature) {
    return yield* invalidToken("Reservation status access token is invalid.");
  }

  const providedSignature = yield* Effect.try({
    try: () => Buffer.from(encodedSignature, "base64url"),
    catch: (cause) =>
      invalidToken("Reservation status access token is invalid.", cause),
  });
  const expectedSignature = signClaims(encodedClaims, secret);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
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
