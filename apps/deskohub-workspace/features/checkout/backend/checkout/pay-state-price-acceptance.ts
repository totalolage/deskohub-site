import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import {
  buildCheckoutPayPathFromToken,
  getPayStateExpiresAt,
  type IssuedPayState,
  issuePayStateContinuation,
} from "./checkout-pay-url";
import { openPayStateForLocale } from "./open-pay-state-for-locale";

type PayStatePriceAcceptance = IssuedPayState & {
  /** `already_accepted`: the state had no price review; its token is returned as is. */
  readonly status: "accepted" | "already_accepted";
};

/**
 * Accepts the price change a Pay state asks the customer to review, with the
 * same continuation the Pay page links to. It touches neither the hold nor
 * the price: submission re-validates both, and the continuation's expiry is
 * the token's own, not the hold's.
 */
export const acceptPayStatePriceChange = Effect.fn(
  "checkout.acceptPayStatePriceChange"
)(function* (input: {
  readonly payStateToken: string;
  readonly locale: Locale;
}) {
  const state = yield* openPayStateForLocale(input);
  if (state.changedKeys === undefined) {
    const unchanged: PayStatePriceAcceptance = {
      status: "already_accepted",
      payStateToken: input.payStateToken,
      payUrl: buildCheckoutPayPathFromToken(input.locale, input.payStateToken),
      expiresAt: getPayStateExpiresAt(state),
    };
    return unchanged;
  }
  const continuation = yield* issuePayStateContinuation(state);
  const accepted: PayStatePriceAcceptance = {
    status: "accepted",
    ...continuation,
  };
  return accepted;
});
