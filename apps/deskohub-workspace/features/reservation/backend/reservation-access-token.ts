import { Data, Effect, Schema } from "effect";
import { env } from "@/env";
import { type Locale, locales } from "@/features/i18n";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  type ReservationAccessToken,
  reservationAccessTokenSchema,
} from "@/features/reservation/reservation-access-token";
import { makeSignedClaims } from "@/shared/backend/signed-claims";

const reservationAccessTokenPurpose = "reservation-access";
const reservationAccessTokenClaimsSchema = Schema.Struct({
  purpose: Schema.Literal(reservationAccessTokenPurpose),
  orderId: workspaceReservationIdSchema,
  locale: Schema.Literals(locales),
  issuedAtEpochMilliseconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

type ReservationAccessTokenClaims =
  typeof reservationAccessTokenClaimsSchema.Type;

const reservationAccessTokenClaims = makeSignedClaims({
  purpose: reservationAccessTokenPurpose,
  schema: reservationAccessTokenClaimsSchema,
});

export class ReservationAccessTokenError extends Data.TaggedError(
  "ReservationAccessTokenError"
)<{
  readonly code: "missing-secret" | "invalid-secret" | "invalid-token";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ReservationAccessTokenOptions = {
  readonly secret?: string | Buffer;
  readonly now?: () => number;
};

const invalidToken = (message: string, cause?: unknown) =>
  new ReservationAccessTokenError({
    code: "invalid-token",
    message,
    cause,
  });

export const getReservationAccessTokenSecret = Effect.fn(
  "reservationAccessToken.getSecret"
)(function* (options: ReservationAccessTokenOptions) {
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

export const createReservationAccessToken = Effect.fn(
  "reservationAccessToken.create"
)(function* (
  input: {
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
  },
  options: ReservationAccessTokenOptions = {}
) {
  const secret = yield* getReservationAccessTokenSecret(options);
  const token = yield* reservationAccessTokenClaims
    .sign(
      {
        purpose: reservationAccessTokenPurpose,
        orderId: input.orderId,
        locale: input.locale,
        issuedAtEpochMilliseconds: options.now?.() ?? Date.now(),
      },
      [secret]
    )
    .pipe(
      Effect.mapError((cause) =>
        invalidToken("Reservation access token claims are invalid.", cause)
      )
    );

  return reservationAccessTokenSchema.make(token);
});

export const openReservationAccessToken = Effect.fn(
  "reservationAccessToken.open"
)(function* (
  input: {
    readonly token: ReservationAccessToken;
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
  },
  options: ReservationAccessTokenOptions = {}
) {
  const claims = yield* reservationAccessTokenClaims
    .open(
      input.token,
      getReservationAccessTokenSecret(options).pipe(
        Effect.map((secret) => [secret] as const)
      )
    )
    .pipe(
      Effect.catchTag("SignedClaimsError", (cause) =>
        Effect.fail(invalidToken("Reservation access token is invalid.", cause))
      )
    );

  if (claims.orderId !== input.orderId || claims.locale !== input.locale) {
    return yield* invalidToken(
      "Reservation access token does not match this reservation."
    );
  }
  return claims satisfies ReservationAccessTokenClaims;
});
