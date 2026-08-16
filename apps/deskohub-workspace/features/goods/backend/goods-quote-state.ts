import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Data, Effect, Schema } from "effect";
import {
  type CheckoutStateCryptoOptions,
  CheckoutStateTokenError,
  checkoutStateClaimsSchema,
  createCheckoutStateClaims,
  openCheckoutState,
  sealCheckoutState,
} from "@/features/checkout/backend/checkout/checkout-state-token";
import { type GoodsCart, goodsCartSchema } from "@/features/goods";
import { type GoodsQuote, goodsQuoteSchema } from "../goods-quote";

export const goodsQuoteStateDefaultTtlMilliseconds = 10 * 60 * 1000;

export const goodsQuoteStateSchema = Schema.Struct({
  ...checkoutStateClaimsSchema.fields,
  dotyposCustomerId: DotyposCustomerIdSchema,
  cart: goodsCartSchema,
  quote: goodsQuoteSchema,
}).annotate({
  identifier: "GoodsQuoteState",
  description:
    "Authenticated goods cart, displayed quote, and customer binding for order issuance.",
});

export type GoodsQuoteState = typeof goodsQuoteStateSchema.Type;

export class GoodsQuoteTokenError extends Data.TaggedError(
  "GoodsQuoteTokenError"
)<{
  readonly reason: "configuration" | "expired" | "invalid";
  readonly cause: unknown;
}> {}

const toGoodsQuoteTokenError = (cause: unknown) => {
  let reason: GoodsQuoteTokenError["reason"] = "invalid";
  if (cause instanceof CheckoutStateTokenError) {
    if (cause.code === "expired") reason = "expired";
    if (cause.code === "missing-secret" || cause.code === "invalid-secret") {
      reason = "configuration";
    }
  }
  return new GoodsQuoteTokenError({ reason, cause });
};

export const buildGoodsQuoteState = Effect.fn("goodsQuoteState.build")(
  function* (
    input: {
      readonly dotyposCustomerId: GoodsQuoteState["dotyposCustomerId"];
      readonly cart: GoodsCart;
      readonly quote: GoodsQuote;
      readonly ttlMilliseconds?: number;
    },
    options: CheckoutStateCryptoOptions = {}
  ) {
    const claims = yield* createCheckoutStateClaims(
      input.ttlMilliseconds ?? goodsQuoteStateDefaultTtlMilliseconds,
      options
    ).pipe(Effect.mapError(toGoodsQuoteTokenError));

    return yield* Schema.decodeUnknownEffect(goodsQuoteStateSchema, {
      onExcessProperty: "error",
    })({
      ...claims,
      dotyposCustomerId: input.dotyposCustomerId,
      cart: input.cart,
      quote: input.quote,
    }).pipe(Effect.mapError(toGoodsQuoteTokenError));
  }
);

export const sealGoodsQuoteState = Effect.fn("goodsQuoteState.seal")(function* (
  state: GoodsQuoteState,
  options: CheckoutStateCryptoOptions = {}
) {
  const encoded = yield* Schema.encodeUnknownEffect(goodsQuoteStateSchema, {
    onExcessProperty: "error",
  })(state).pipe(Effect.mapError(toGoodsQuoteTokenError));

  return yield* sealCheckoutState(encoded, state.kid, options).pipe(
    Effect.mapError(toGoodsQuoteTokenError)
  );
});

export const openGoodsQuoteState = Effect.fn("goodsQuoteState.open")(
  (token: string, options: CheckoutStateCryptoOptions = {}) =>
    openCheckoutState(token, goodsQuoteStateSchema, options).pipe(
      Effect.mapError(toGoodsQuoteTokenError)
    )
);
