import { Data, Effect, Match, Schema } from "effect";
import type { CheckoutSummary } from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { payStateTokenQueryParam } from "@/features/checkout/pay-state-token-query";
import type { AppliedDiscount } from "@/features/discounts";
import {
  makeLegacySealedState,
  type SealedStateIssueOptions,
  type SealedStateSealOptions,
  type SealedStateTokenError,
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

/**
 * Pay-state tokens live in open Pay pages and agent links, so they keep the
 * sealed state format that predates purposes.
 */
const payStateCodec = makeLegacySealedState({
  schema: signedPayStateSchema,
  ttlMilliseconds: payStateDefaultTtlMilliseconds,
});

/** How a Pay link is issued and sealed; agents' stable links set both. */
export type PayStateLinkOptions = SealedStateIssueOptions &
  SealedStateSealOptions;

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

const payStateTokenMessages = {
  "missing-secret": "At least one Pay state encryption key is required.",
  "invalid-secret": "Pay state configuration is invalid.",
  "invalid-token": "Invalid Pay state token.",
  "unknown-kid": "Pay state token used an unknown key id.",
  expired: "Pay state token expired.",
} as const satisfies Record<SealedStateTokenError["code"], string>;

export class PayStateTokenError extends Data.TaggedError("PayStateTokenError")<{
  readonly code: SealedStateTokenError["code"];
  readonly message: string;
  readonly cause?: unknown;
}> {
  static fromSealedState = (cause: SealedStateTokenError) =>
    new PayStateTokenError({
      code: cause.code,
      message: payStateTokenMessages[cause.code],
      cause,
    });

  static invalidState = (cause: Schema.SchemaError) =>
    new PayStateTokenError({
      code: "invalid-token",
      message: "Invalid Pay state.",
      cause,
    });
}

export const buildSignedPayState = Effect.fn("payState.build")(function* (
  input: BuildSignedPayStateInput,
  options: SealedStateIssueOptions = {}
) {
  const claims = yield* payStateCodec
    .issueClaims({
      issuedAt: options.issuedAt,
      ttlMilliseconds: input.ttlMilliseconds,
    })
    .pipe(Effect.mapError(PayStateTokenError.fromSealedState));
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
    Effect.mapError(PayStateTokenError.invalidState)
  );
});

export const sealPayState = Effect.fn("payState.seal")(
  (state: SignedPayState, options: SealedStateSealOptions = {}) =>
    payStateCodec
      .seal(state, options)
      .pipe(Effect.mapError(PayStateTokenError.fromSealedState))
);

export const openPayState = Effect.fn("payState.open")((token: string) =>
  payStateCodec
    .open(token)
    .pipe(
      Effect.map(preserveSignedPayStateMetadataInvariant),
      Effect.mapError(PayStateTokenError.fromSealedState)
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

/**
 * The reservation kind of an authenticated Pay state, expired or not, so an
 * expired Pay page can restart its reservation. Nothing else may act on
 * state read this way.
 */
export const getPayStateRestartKind = Effect.fn("payState.getRestartKind")(
  (token: string) =>
    payStateCodec.inspect(token).pipe(
      Effect.map((state) => state.reservation.kind),
      Effect.mapError(PayStateTokenError.fromSealedState)
    )
);

export const sealPayStateForUrl = Effect.fn("payState.sealForUrl")(function* (
  state: SignedPayState,
  options: SealedStateSealOptions = {}
) {
  const token = yield* sealPayState(state, options);

  return {
    type: "sealedPayState" as const,
    token,
    queryParam: payStateTokenQueryParam,
  };
});
