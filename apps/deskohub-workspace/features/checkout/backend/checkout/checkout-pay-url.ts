import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import type { CheckoutStateCryptoOptions } from "./checkout-state-token";
import {
  type BuildSignedPayStateInput,
  buildSignedPayState,
  getSignedPayStateReissueInput,
  type SealPayStateForUrlResult,
  type SignedPayState,
  sealPayStateForUrl,
} from "./pay-state";

export const discountCodeErrorQueryParam = "discountCodeError" as const;

export const buildCheckoutPayPath = (
  locale: Locale,
  sealedState: SealPayStateForUrlResult,
  options: { readonly orderId?: string } = {}
) => {
  const searchParams = new URLSearchParams();
  searchParams.set(sealedState.queryParam, sealedState.token);
  if (options.orderId) {
    searchParams.set("orderId", options.orderId);
  }

  return `/${locale}/checkout/pay?${searchParams}`;
};

export const buildFreshCheckoutPayPath = Effect.fn("buildFreshCheckoutPayPath")(
  function* (
    input: BuildSignedPayStateInput,
    options: CheckoutStateCryptoOptions = {}
  ) {
    const freshState = yield* buildSignedPayState(input, options);
    const sealedState = yield* sealPayStateForUrl(freshState, options);
    return buildCheckoutPayPath(input.locale, sealedState);
  }
);

export const buildCheckoutPayContinuationPath = Effect.fn(
  "buildCheckoutPayContinuationPath"
)((state: SignedPayState, options: CheckoutStateCryptoOptions = {}) => {
  const { changedKeys: _changedKeys, ...continuation } =
    getSignedPayStateReissueInput(state);

  return buildFreshCheckoutPayPath(continuation, options);
});
