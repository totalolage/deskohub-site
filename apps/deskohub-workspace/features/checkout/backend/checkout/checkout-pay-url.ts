import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import type { CheckoutStateCryptoOptions } from "./checkout-state-token";
import {
  type BuildSignedPayStateInput,
  buildSignedPayState,
  payStateTokenQueryParam,
  type SealPayStateForUrlResult,
  type SignedPayState,
  sealPayStateForUrl,
} from "./pay-state";

export const discountCodeErrorQueryParam = "discountCodeError" as const;

type CheckoutPayPathOptions = {
  readonly discountCodeError?: "unavailable";
  readonly orderId?: string;
};

export const buildCheckoutPayPathFromToken = (
  locale: Locale,
  payStateToken: string,
  options: CheckoutPayPathOptions = {}
) => {
  const searchParams = new URLSearchParams({
    [payStateTokenQueryParam]: payStateToken,
  });
  if (options.orderId) {
    searchParams.set("orderId", options.orderId);
  }
  if (options.discountCodeError) {
    searchParams.set(discountCodeErrorQueryParam, options.discountCodeError);
  }

  return `/${locale}/checkout/pay?${searchParams}`;
};

export const buildCheckoutPayPath = (
  locale: Locale,
  sealedState: SealPayStateForUrlResult,
  options: CheckoutPayPathOptions = {}
) => buildCheckoutPayPathFromToken(locale, sealedState.token, options);

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
)((state: SignedPayState, options: CheckoutStateCryptoOptions = {}) =>
  buildFreshCheckoutPayPath({ ...state, changedKeys: undefined }, options)
);
