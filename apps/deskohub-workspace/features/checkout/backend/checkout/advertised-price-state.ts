import { Data, Effect, Predicate, Schema } from "effect";
import {
  type CoworkReservationQuote,
  coworkReservationQuoteSchema,
} from "@/features/checkout/checkout-quote";
import {
  type MeetingRoomReservationQuote,
  meetingRoomReservationQuoteSchema,
} from "@/features/checkout/reservation-quote-meeting-room";
import type { Locale } from "@/features/i18n";
import {
  type CoworkAdvertisedPriceReservation,
  coworkAdvertisedPriceReservationSchema,
} from "@/features/reservation/cowork-reservation";
import {
  type MeetingRoomAdvertisedPriceReservation,
  meetingRoomAdvertisedPriceReservationSchema,
} from "@/features/reservation/meeting-room-reservation";
import {
  type CheckoutStateCryptoOptions,
  CheckoutStateTokenError,
  createCheckoutStateClaims,
  openCheckoutState,
  sealCheckoutState,
} from "./checkout-state-token";
import { workspaceCheckoutPriceStateSchema } from "./workspace-checkout-price-state";

export const advertisedPriceStateDefaultTtlMilliseconds = 10 * 60 * 1000;

export const advertisedPriceStateSchema = Schema.Union([
  Schema.Struct({
    ...workspaceCheckoutPriceStateSchema.fields,
    kind: coworkAdvertisedPriceReservationSchema.fields.kind,
    reservation: coworkAdvertisedPriceReservationSchema,
    quote: coworkReservationQuoteSchema,
  }),
  Schema.Struct({
    ...workspaceCheckoutPriceStateSchema.fields,
    kind: meetingRoomAdvertisedPriceReservationSchema.fields.kind,
    reservation: meetingRoomAdvertisedPriceReservationSchema,
    quote: meetingRoomReservationQuoteSchema,
  }),
]).annotate({
  identifier: "AdvertisedPriceState",
  description:
    "PII-free Workspace price advertisement state protected for reservation submission.",
});

export type AdvertisedPriceState = typeof advertisedPriceStateSchema.Type;

type AdvertisedPriceStateInput =
  | {
      readonly kind: "cowork";
      readonly locale: Locale;
      readonly reservation: CoworkAdvertisedPriceReservation;
      readonly quote: CoworkReservationQuote;
      readonly ttlMilliseconds?: number;
    }
  | {
      readonly kind: "meeting-room";
      readonly locale: Locale;
      readonly reservation: MeetingRoomAdvertisedPriceReservation;
      readonly quote: MeetingRoomReservationQuote;
      readonly ttlMilliseconds?: number;
    };

export class AdvertisedPriceStateTokenError extends Data.TaggedError(
  "AdvertisedPriceStateTokenError"
)<{
  readonly code: CheckoutStateTokenError["code"];
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AdvertisedPriceMismatchError extends Data.TaggedError(
  "AdvertisedPriceMismatchError"
)<{
  readonly reason: "invalid_token" | "input_mismatch";
  readonly message: string;
  readonly cause?: unknown;
}> {}

const isCheckoutStateTokenError = (
  cause: unknown
): cause is CheckoutStateTokenError =>
  Predicate.isTagged(cause, CheckoutStateTokenError._tag);

const toAdvertisedPriceStateTokenError = (cause: unknown) =>
  isCheckoutStateTokenError(cause)
    ? new AdvertisedPriceStateTokenError({
        code: cause.code,
        message: cause.message,
        cause,
      })
    : new AdvertisedPriceStateTokenError({
        code: "invalid-token",
        message: "Invalid advertised price state.",
        cause,
      });

export const buildAdvertisedPriceState = Effect.fn(
  "advertisedPriceState.build"
)(function* (
  input: AdvertisedPriceStateInput,
  options: CheckoutStateCryptoOptions = {}
) {
  const claims = yield* createCheckoutStateClaims(
    input.ttlMilliseconds ?? advertisedPriceStateDefaultTtlMilliseconds,
    options
  ).pipe(Effect.mapError(toAdvertisedPriceStateTokenError));

  return yield* Schema.decodeUnknownEffect(advertisedPriceStateSchema, {
    onExcessProperty: "error",
  })({
    ...claims,
    kind: input.kind,
    locale: input.locale,
    reservation: input.reservation,
    quote: input.quote,
  }).pipe(Effect.mapError(toAdvertisedPriceStateTokenError));
});

export const sealAdvertisedPriceState = Effect.fn("advertisedPriceState.seal")(
  function* (
    state: AdvertisedPriceState,
    options: CheckoutStateCryptoOptions = {}
  ) {
    const encodedState = yield* Schema.encodeUnknownEffect(
      advertisedPriceStateSchema,
      { onExcessProperty: "error" }
    )(state).pipe(Effect.mapError(toAdvertisedPriceStateTokenError));

    return yield* sealCheckoutState(encodedState, options).pipe(
      Effect.mapError(toAdvertisedPriceStateTokenError)
    );
  }
);

export const openAdvertisedPriceState = Effect.fn("advertisedPriceState.open")(
  (token: string, options: CheckoutStateCryptoOptions = {}) =>
    openCheckoutState(token, advertisedPriceStateSchema, options).pipe(
      Effect.mapError(toAdvertisedPriceStateTokenError)
    )
);

export const openSubmittedAdvertisedPriceState = Effect.fn(
  "advertisedPriceState.openSubmitted"
)((token: string) =>
  openAdvertisedPriceState(token).pipe(
    Effect.mapError(
      (cause) =>
        new AdvertisedPriceMismatchError({
          reason: "invalid_token",
          message: "Advertised price snapshot is invalid or expired.",
          cause,
        })
    )
  )
);
