import { Data, Effect, Match, Schema } from "effect";
import type { CheckoutSummary } from "@/features/checkout/checkout-quote";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/reservation-quote-meeting-room";
import {
  type CheckoutStateCryptoOptions,
  type CheckoutStateKey,
  CheckoutStateTokenError,
  createCheckoutStateClaims,
  openCheckoutState,
  parseCheckoutStateKey,
  sealCheckoutState,
} from "./checkout-state-token";
import {
  type BuildSignedCoworkPayStateInput,
  buildSignedCoworkPayState,
  coworkSignedPayStateSchema,
} from "./cowork-pay-state";
import {
  type BuildSignedMeetingRoomPayStateInput,
  buildSignedMeetingRoomPayState,
  meetingRoomSignedPayStateSchema,
} from "./meeting-room-pay-state";

export const payStateTokenQueryParam = "payState" as const;
export const payStateDefaultTtlMilliseconds = 10 * 60 * 1000;

export const signedPayStateSchema = Schema.Union([
  coworkSignedPayStateSchema,
  meetingRoomSignedPayStateSchema,
]).annotate({
  identifier: "SignedPayState",
  description: "Workspace checkout Pay state payload.",
});

export type SignedPayState = typeof signedPayStateSchema.Type;

export type PayStateKey = CheckoutStateKey;

export type SealPayStateForUrlResult = {
  readonly type: "sealedPayState";
  readonly token: string;
  readonly queryParam: typeof payStateTokenQueryParam;
};

export type BuildSignedPayStateInput =
  | BuildSignedCoworkPayStateInput
  | BuildSignedMeetingRoomPayStateInput;

export const getSignedPayStateCheckoutSummary = (
  state: SignedPayState
): CheckoutSummary =>
  Match.value(state).pipe(
    Match.when(
      { reservation: { kind: "cowork" } },
      ({ quote }) => quote.summary
    ),
    Match.when({ reservation: { kind: "meeting-room" } }, ({ quote }) =>
      getMeetingRoomCheckoutSummary(quote)
    ),
    Match.exhaustive
  );

export class PayStateTokenError extends Data.TaggedError("PayStateTokenError")<{
  readonly code: CheckoutStateTokenError["code"];
  readonly message: string;
  readonly cause?: unknown;
}> {}

const toPayStateTokenError = (cause: unknown) =>
  cause instanceof CheckoutStateTokenError
    ? new PayStateTokenError({
        code: cause.code,
        message: cause.message.replaceAll("checkout state", "Pay state"),
        cause,
      })
    : new PayStateTokenError({
        code: "invalid-token",
        message: "Invalid Pay state.",
        cause,
      });

export const parsePayStateKey = Effect.fn("payState.parseKey")(
  (kid: string, base64UrlKey: string) =>
    parseCheckoutStateKey(kid, base64UrlKey).pipe(
      Effect.mapError(toPayStateTokenError)
    )
);

export const buildSignedPayState = Effect.fn("payState.build")(function* (
  input: BuildSignedPayStateInput,
  options: CheckoutStateCryptoOptions = {}
) {
  const claims = yield* createCheckoutStateClaims(
    input.ttlMilliseconds ?? payStateDefaultTtlMilliseconds,
    options
  ).pipe(Effect.mapError(toPayStateTokenError));
  const envelope = {
    ...claims,
    locale: input.locale,
    orderId: input.orderId,
  };
  const state = Match.value(input).pipe(
    Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
      buildSignedCoworkPayState(envelope, coworkInput)
    ),
    Match.when({ reservation: { kind: "meeting-room" } }, (meetingRoomInput) =>
      buildSignedMeetingRoomPayState(envelope, meetingRoomInput)
    ),
    Match.exhaustive
  );

  return yield* Schema.decodeUnknownEffect(signedPayStateSchema, {
    onExcessProperty: "error",
  })(state).pipe(Effect.mapError(toPayStateTokenError));
});

export const sealPayState = Effect.fn("payState.seal")(function* (
  state: SignedPayState,
  options: CheckoutStateCryptoOptions = {}
) {
  const encodedState = yield* Schema.encodeUnknownEffect(signedPayStateSchema, {
    onExcessProperty: "error",
  })(state).pipe(Effect.mapError(toPayStateTokenError));

  return yield* sealCheckoutState(encodedState, options).pipe(
    Effect.mapError(toPayStateTokenError)
  );
});

export const openPayState = Effect.fn("payState.open")(
  (token: string, options: CheckoutStateCryptoOptions = {}) =>
    openCheckoutState(token, signedPayStateSchema, options).pipe(
      Effect.mapError(toPayStateTokenError)
    )
);

export const sealPayStateForUrl = Effect.fn("payState.sealForUrl")(function* (
  state: SignedPayState,
  options: CheckoutStateCryptoOptions = {}
) {
  const token = yield* sealPayState(state, options);

  return {
    type: "sealedPayState" as const,
    token,
    queryParam: payStateTokenQueryParam,
  };
});

export const buildPayStateQueryParams = (result: SealPayStateForUrlResult) => {
  const searchParams = new URLSearchParams();
  searchParams.set(payStateTokenQueryParam, result.token);

  return searchParams;
};
