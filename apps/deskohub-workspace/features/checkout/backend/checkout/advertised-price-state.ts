import { Data, Effect, Schema } from "effect";
import { workspaceAdvertisedPriceReservationSchema } from "@/features/checkout/advertised-price";
import type { Locale } from "@/features/i18n";
import {
  type CheckoutStateCryptoOptions,
  CheckoutStateTokenError,
  createCheckoutStateClaims,
  openCheckoutState,
  sealCheckoutState,
} from "./checkout-state-token";
import { workspaceCheckoutPriceStateSchema } from "./workspace-checkout-price-state";

export const advertisedPriceStateDefaultTtlMilliseconds = 10 * 60 * 1000;

export const advertisedPriceStateSchema = Schema.Struct({
  ...workspaceCheckoutPriceStateSchema.fields,
  reservation: workspaceAdvertisedPriceReservationSchema,
  identifiedPricing: Schema.Literal("not_evaluated"),
}).annotate({
  identifier: "AdvertisedPriceState",
  description:
    "PII-free Workspace price advertisement state protected for reservation submission.",
});

export type AdvertisedPriceState = typeof advertisedPriceStateSchema.Type;
export type AdvertisedPriceStateCryptoOptions = CheckoutStateCryptoOptions;

export class AdvertisedPriceStateTokenError extends Data.TaggedError(
  "AdvertisedPriceStateTokenError"
)<{
  readonly code: CheckoutStateTokenError["code"];
  readonly message: string;
  readonly cause?: unknown;
}> {}

const toAdvertisedPriceStateTokenError = (cause: unknown) =>
  cause instanceof CheckoutStateTokenError
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
  input: {
    readonly locale: Locale;
    readonly reservation: AdvertisedPriceState["reservation"];
    readonly quote: AdvertisedPriceState["quote"];
    readonly ttlMilliseconds?: number;
  },
  options: AdvertisedPriceStateCryptoOptions = {}
) {
  const claims = yield* createCheckoutStateClaims(
    input.ttlMilliseconds ?? advertisedPriceStateDefaultTtlMilliseconds,
    options
  ).pipe(Effect.mapError(toAdvertisedPriceStateTokenError));

  return yield* Schema.decodeUnknownEffect(advertisedPriceStateSchema, {
    onExcessProperty: "error",
  })({
    ...claims,
    locale: input.locale,
    reservation: input.reservation,
    quote: input.quote,
    identifiedPricing: "not_evaluated",
  }).pipe(Effect.mapError(toAdvertisedPriceStateTokenError));
});

export const sealAdvertisedPriceState = Effect.fn("advertisedPriceState.seal")(
  function* (
    state: AdvertisedPriceState,
    options: AdvertisedPriceStateCryptoOptions = {}
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
  (token: string, options: AdvertisedPriceStateCryptoOptions = {}) =>
    openCheckoutState(token, advertisedPriceStateSchema, options).pipe(
      Effect.mapError(toAdvertisedPriceStateTokenError)
    )
);
