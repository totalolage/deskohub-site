import { Effect, Match } from "effect";
import type { Locale } from "@/features/i18n";
import type { CheckoutStateCryptoOptions } from "./checkout-state-token";
import {
  type BuildSignedPayStateInput,
  buildSignedPayState,
  type SealPayStateForUrlResult,
  type SignedPayState,
  sealPayStateForUrl,
} from "./pay-state";

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
)((state: SignedPayState, options: CheckoutStateCryptoOptions = {}) =>
  Match.value(state).pipe(
    Match.when({ reservation: { kind: "cowork" } }, (coworkState) =>
      buildFreshCheckoutPayPath(
        {
          locale: coworkState.locale,
          reservation: coworkState.reservation,
          quote: coworkState.quote,
          orderId: coworkState.orderId,
          checkoutSessionId: coworkState.checkoutSessionId,
          submittedCode: coworkState.submittedCode,
        },
        options
      )
    ),
    Match.when({ reservation: { kind: "meeting-room" } }, (meetingRoomState) =>
      buildFreshCheckoutPayPath(
        {
          locale: meetingRoomState.locale,
          reservation: meetingRoomState.reservation,
          quote: meetingRoomState.quote,
          orderId: meetingRoomState.orderId,
          checkoutSessionId: meetingRoomState.checkoutSessionId,
          submittedCode: meetingRoomState.submittedCode,
        },
        options
      )
    ),
    Match.exhaustive
  )
);
