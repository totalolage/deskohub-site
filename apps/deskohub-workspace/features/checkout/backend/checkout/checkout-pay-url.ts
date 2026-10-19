import { Effect } from "effect";
import type { DiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { SealedStateCryptoOptions } from "@/shared/backend/sealed-state";
import {
  type BuildSignedPayStateInput,
  buildSignedPayState,
  payStateTokenQueryParam,
  type SealPayStateForUrlResult,
  type SignedPayState,
  sealPayStateForUrl,
} from "./pay-state";

export const discountCodeErrorQueryParam = "discountCodeError" as const;
export const discountCodeErrorIdQueryParam = "discountCodeErrorId" as const;

type CheckoutPayPathOptions = {
  readonly discountCodeError?: DiscountCodeRejection;
  readonly discountCodeErrorId?: string;
  readonly orderId?: WorkspaceReservationId;
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
  if (options.discountCodeErrorId) {
    searchParams.set(
      discountCodeErrorIdQueryParam,
      options.discountCodeErrorId
    );
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
    options: SealedStateCryptoOptions = {},
    pathOptions: CheckoutPayPathOptions = {}
  ) {
    const freshState = yield* buildSignedPayState(input, options);
    const sealedState = yield* sealPayStateForUrl(freshState, options);
    return buildCheckoutPayPath(input.locale, sealedState, pathOptions);
  }
);

export const buildCheckoutPayContinuationPath = Effect.fn(
  "buildCheckoutPayContinuationPath"
)((state: SignedPayState, options: SealedStateCryptoOptions = {}) =>
  buildFreshCheckoutPayPath({ ...state, changedKeys: undefined }, options)
);
