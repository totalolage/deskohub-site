import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import {
  type BuildSignedPayStateInput,
  buildSignedPayState,
  type PayStateCryptoOptions,
  type SealPayStateForUrlResult,
  sealPayStateForUrl,
} from "./pay-state";

export const buildCheckoutPayPath = (
  locale: Locale,
  sealedState: SealPayStateForUrlResult
) => {
  const searchParams = new URLSearchParams();
  searchParams.set(sealedState.queryParam, sealedState.token);

  return `/${locale}/checkout/pay?${searchParams}`;
};

export const buildFreshCheckoutPayPath = Effect.fn("buildFreshCheckoutPayPath")(
  function* (
    input: BuildSignedPayStateInput,
    options: PayStateCryptoOptions = {}
  ) {
    const freshState = yield* buildSignedPayState(input, options);
    const sealedState = yield* sealPayStateForUrl(freshState, options);
    return buildCheckoutPayPath(input.locale, sealedState);
  }
);
