import { createHmac, timingSafeEqual } from "node:crypto";
import { Data, Effect, Schema } from "effect";
import { env } from "@/env";
import { type Locale, locales } from "@/features/i18n";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";

export const reservationAccessTokenQueryParam = "accessToken" as const;

const reservationAccessTokenPurpose = "reservation-access";
const reservationAccessTokenClaimsSchema = Schema.Struct({
  purpose: Schema.Literal(reservationAccessTokenPurpose),
  orderId: workspaceReservationIdSchema,
  locale: Schema.Literals(locales),
  issuedAtEpochMilliseconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

type ReservationAccessTokenClaims =
  typeof reservationAccessTokenClaimsSchema.Type;

export class ReservationAccessTokenError extends Data.TaggedError(
  "ReservationAccessTokenError"
)<{
  readonly code: "missing-secret" | "invalid-secret" | "invalid-token";
  readonly message: string;
  readonly cause?: unknown;
}> {}

type ReservationAccessTokenOptions = {
  readonly secret?: string | Buffer;
  readonly now?: () => number;
};

const invalidToken = (message: string, cause?: unknown) =>
  new ReservationAccessTokenError({
    code: "invalid-token",
    message,
    cause,
  });

const getSecret = Effect.fn("reservationAccessToken.getSecret")(function* (
  options: ReservationAccessTokenOptions
) {
  const configuredSecret =
    options.secret ?? env.RESERVATION_ACCESS_TOKEN_SECRET;
  if (!configuredSecret) {
    return yield* new ReservationAccessTokenError({
      code: "missing-secret",
      message: "Reservation access token secret is unavailable.",
    });
  }

  const secret = Buffer.isBuffer(configuredSecret)
    ? configuredSecret
    : Buffer.from(configuredSecret);
  if (secret.byteLength < 32) {
    return yield* new ReservationAccessTokenError({
      code: "invalid-secret",
      message: "Reservation access token secret must be at least 32 bytes.",
    });
  }

  return secret;
});

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
  },
  options: ReservationAccessTokenOptions = {}
) {
  const secret = yield* getSecret(options);
  const claims = yield* Schema.decodeUnknownEffect(
    reservationAccessTokenClaimsSchema
  )({
    purpose: reservationAccessTokenPurpose,
    orderId: input.orderId,
    locale: input.locale,
    issuedAtEpochMilliseconds: options.now?.() ?? Date.now(),
  }).pipe(
    Effect.mapError((cause) =>
      invalidToken("Reservation access token claims are invalid.", cause)
    )
  );
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString(
    "base64url"
  );
  const signature = signClaims(encodedClaims, secret).toString("base64url");

  return `${encodedClaims}.${signature}`;
});

export const openReservationAccessToken = Effect.fn(
  "reservationAccessToken.open"
)(function* (
  input: {
    readonly token: string;
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
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
  const secret = yield* getSecret(options);
  const providedSignature = yield* Effect.try({
    try: () => Buffer.from(encodedSignature, "base64url"),
    catch: (cause) =>
      invalidToken("Reservation access token is invalid.", cause),
  });
  const expectedSignature = signClaims(encodedClaims, secret);
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
  return claims satisfies ReservationAccessTokenClaims;
});
