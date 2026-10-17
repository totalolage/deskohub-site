import { Data, Effect, Match, Schema } from "effect";
import type { CheckoutSummary } from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { payStateTokenQueryParam } from "@/features/checkout/pay-state-token-query";
import type { AppliedDiscount } from "@/features/discounts";
import {
  createSealedStateClaims,
  decodeSealedState,
  openSealedState,
  parseSealedStateKey,
  type SealedStateCryptoOptions,
  type SealedStateKey,
  SealedStateTokenError,
  sealState,
} from "@/shared/backend/sealed-state";
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
import {
  type BuildSignedOfficePayStateInput,
  buildSignedOfficePayState,
  officeSignedPayStateSchema,
} from "./office-pay-state";
import type { PayStateSubmittedCodeMetadata } from "./pay-state-contract";

export { payStateTokenQueryParam };
export const payStateDefaultTtlMilliseconds = 10 * 60 * 1000;

export const signedPayStateSchema = Schema.Union([
  coworkSignedPayStateSchema,
  meetingRoomSignedPayStateSchema,
  officeSignedPayStateSchema,
])
  .check(
    Schema.makeFilter(
      ({ submittedCode, submittedCodeDiscountId }) =>
        (submittedCode === undefined) ===
          (submittedCodeDiscountId === undefined) || {
          path: ["submittedCodeDiscountId"],
          issue:
            "submitted code and submitted code discount id must occur together",
        }
    )
  )
  .annotate({
    identifier: "SignedPayState",
    description: "Workspace checkout Pay state payload.",
  });

export type SignedPayState = typeof signedPayStateSchema.Type &
  PayStateSubmittedCodeMetadata;

const preserveSignedPayStateMetadataInvariant = (
  state: typeof signedPayStateSchema.Type
): SignedPayState => state as SignedPayState;

export type PayStateKey = SealedStateKey;

export type SealPayStateForUrlResult = {
  readonly type: "sealedPayState";
  readonly token: string;
  readonly queryParam: typeof payStateTokenQueryParam;
};

export type BuildSignedPayStateInput =
  | BuildSignedCoworkPayStateInput
  | BuildSignedMeetingRoomPayStateInput
  | BuildSignedOfficePayStateInput;

export const getSignedPayStateCheckoutSummary = (
  state: SignedPayState
): CheckoutSummary =>
  Match.value(state).pipe(
    Match.when({ reservation: { kind: "cowork" } }, ({ quote, reservation }) =>
      getCoworkCheckoutSummary(reservation, quote)
    ),
    Match.when({ reservation: { kind: "meeting-room" } }, ({ quote }) =>
      getMeetingRoomCheckoutSummary(quote)
    ),
    Match.when({ reservation: { kind: "office" } }, ({ quote }) =>
      getOfficeCheckoutSummary(quote)
    ),
    Match.exhaustive
  );

export const getSignedPayStateSubmittedCodeApplication = (
  state: SignedPayState
): AppliedDiscount | undefined => {
  if (state.submittedCodeDiscountId === undefined) return undefined;

  return state.quote.payment.discounts.find(
    ({ discount }) => discount.id === state.submittedCodeDiscountId
  );
};

export const getSignedPayStateSubmittedCode = (
  state: SignedPayState,
  displayedDiscounts: readonly AppliedDiscount[] = state.quote.payment.discounts
): PayStateSubmittedCodeMetadata => {
  const application = displayedDiscounts.find(
    ({ discount }) => discount.id === state.submittedCodeDiscountId
  );
  if (state.submittedCode === undefined || application === undefined) return {};

  return {
    submittedCode: state.submittedCode,
    submittedCodeDiscountId: application.discount.id,
  };
};

/**
 * Booking moment locked into the Pay state at reservation submission. Later
 * price affirmations evaluate calendar sales at this moment instead of now.
 */
export const getSignedPayStateBookedAt = (
  state: Pick<SignedPayState, "bookedAt">
) => Temporal.Instant.from(state.bookedAt);

export class PayStateTokenError extends Data.TaggedError("PayStateTokenError")<{
  readonly code: SealedStateTokenError["code"];
  readonly message: string;
  readonly cause?: unknown;
}> {}

const toPayStateTokenError = (cause: unknown) =>
  cause instanceof SealedStateTokenError
    ? new PayStateTokenError({
        code: cause.code,
        message: cause.message.replaceAll("sealed state", "Pay state"),
        cause,
      })
    : new PayStateTokenError({
        code: "invalid-token",
        message: "Invalid Pay state.",
        cause,
      });

export const parsePayStateKey = Effect.fn("payState.parseKey")(
  (kid: string, base64UrlKey: string) =>
    parseSealedStateKey(kid, base64UrlKey).pipe(
      Effect.mapError(toPayStateTokenError)
    )
);

export const buildSignedPayState = Effect.fn("payState.build")(function* (
  input: BuildSignedPayStateInput,
  options: SealedStateCryptoOptions = {}
) {
  const claims = yield* createSealedStateClaims(
    input.ttlMilliseconds ?? payStateDefaultTtlMilliseconds,
    options
  ).pipe(Effect.mapError(toPayStateTokenError));
  const envelope = {
    ...claims,
    locale: input.locale,
    orderId: input.orderId,
    bookedAt: input.bookedAt,
  };
  const state = Match.value(input).pipe(
    Match.when({ reservation: { kind: "cowork" } }, (coworkInput) =>
      buildSignedCoworkPayState(envelope, coworkInput)
    ),
    Match.when({ reservation: { kind: "meeting-room" } }, (meetingRoomInput) =>
      buildSignedMeetingRoomPayState(envelope, meetingRoomInput)
    ),
    Match.when({ reservation: { kind: "office" } }, (officeInput) =>
      buildSignedOfficePayState(envelope, officeInput)
    ),
    Match.exhaustive
  );

  return yield* Schema.decodeUnknownEffect(signedPayStateSchema, {
    onExcessProperty: "error",
  })(state).pipe(
    Effect.map(preserveSignedPayStateMetadataInvariant),
    Effect.mapError(toPayStateTokenError)
  );
});

export const sealPayState = Effect.fn("payState.seal")(function* (
  state: SignedPayState,
  options: SealedStateCryptoOptions = {}
) {
  const encodedState = yield* Schema.encodeUnknownEffect(signedPayStateSchema, {
    onExcessProperty: "error",
  })(state).pipe(Effect.mapError(toPayStateTokenError));

  return yield* sealState(encodedState, state.kid, options).pipe(
    Effect.mapError(toPayStateTokenError)
  );
});

export const openPayState = Effect.fn("payState.open")(
  (token: string, options: SealedStateCryptoOptions = {}) =>
    openSealedState(token, signedPayStateSchema, options).pipe(
      Effect.map(preserveSignedPayStateMetadataInvariant),
      Effect.mapError(toPayStateTokenError)
    )
);

/**
 * Whether an opened Pay state continues on a page: it was issued for the
 * page's locale and, on a reservation page, for that page's reservation kind.
 * The Pay page accepts every kind. The pages and the proxy share this check,
 * so a URL keeps its issued locale exactly when its page will accept it.
 */
export const payStateContinuesOn = (
  state: Pick<SignedPayState, "locale" | "reservation">,
  page: {
    readonly locale: string;
    readonly reservationKind?: SignedPayState["reservation"]["kind"];
  }
): boolean =>
  state.locale === page.locale &&
  (page.reservationKind === undefined ||
    state.reservation.kind === page.reservationKind);

export const getPayStateRestartKind = Effect.fn("payState.getRestartKind")(
  (token: string, options: SealedStateCryptoOptions = {}) =>
    decodeSealedState(token, signedPayStateSchema, options).pipe(
      Effect.map((state) => state.reservation.kind),
      Effect.mapError(toPayStateTokenError)
    )
);

export const sealPayStateForUrl = Effect.fn("payState.sealForUrl")(function* (
  state: SignedPayState,
  options: SealedStateCryptoOptions = {}
) {
  const token = yield* sealPayState(state, options);

  return {
    type: "sealedPayState" as const,
    token,
    queryParam: payStateTokenQueryParam,
  };
});
