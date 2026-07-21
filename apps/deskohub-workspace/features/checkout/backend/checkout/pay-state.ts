import { Data, Effect, Match, Schema } from "effect";
import {
  type CheckoutSummaryChangedKeys,
  checkoutSummaryChangedKeysSchema,
  type WorkspaceCheckoutQuote,
} from "@/features/checkout/checkout-quote";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import {
  type CanonicalDiscountCode,
  canonicalDiscountCodeSchema,
} from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import {
  type CheckoutStateCryptoOptions,
  type CheckoutStateKey,
  CheckoutStateTokenError,
  createCheckoutStateClaims,
  openCheckoutState,
  parseCheckoutStateKey,
  sealCheckoutState,
} from "./checkout-state-token";
import { workspaceCheckoutPriceStateSchema } from "./workspace-checkout-price-state";

export const payStateTokenQueryParam = "payState" as const;
export const payStateDefaultTtlMilliseconds = 10 * 60 * 1000;

export const signedPayStateSchema = Schema.Struct({
  ...workspaceCheckoutPriceStateSchema.fields,
  orderId: Schema.NonEmptyString,
  reservationIntentId: Schema.optional(Schema.NonEmptyString),
  reservation: normalizedCoworkReservationOrderSchema,
  acceptedTotal: nonNegativeWorkspaceMoneyCodec,
  submittedCode: Schema.optional(canonicalDiscountCodeSchema),
  changedKeys: Schema.optional(checkoutSummaryChangedKeysSchema),
}).annotate({
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

export type BuildSignedPayStateInput = {
  readonly locale: Locale;
  readonly reservation: Schema.Schema.Type<
    typeof normalizedCoworkReservationOrderSchema
  >;
  readonly quote: WorkspaceCheckoutQuote;
  readonly orderId: string;
  readonly reservationIntentId?: string;
  readonly submittedCode?: CanonicalDiscountCode;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly ttlMilliseconds?: number;
};

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
  const reservationBase = {
    kind: "cowork" as const,
    date: input.reservation.date,
    name: input.reservation.name,
    email: input.reservation.email,
    phone: input.reservation.phone,
    ...(input.reservation.message !== undefined && {
      message: input.reservation.message,
    }),
  };

  return yield* Schema.decodeUnknownEffect(signedPayStateSchema, {
    onExcessProperty: "error",
  })({
    ...claims,
    locale: input.locale,
    orderId: input.orderId,
    ...(input.reservationIntentId && {
      reservationIntentId: input.reservationIntentId,
    }),
    reservation: Match.value(input.quote.order).pipe(
      Match.discriminatorsExhaustive("entryTier")({
        basic: (product) => ({ ...reservationBase, ...product }),
        plus: (product) => ({ ...reservationBase, ...product }),
        profi: (product) => ({ ...reservationBase, ...product }),
      })
    ),
    quote: {
      fingerprint: input.quote.fingerprint,
      order: input.quote.order,
      summary: input.quote.summary,
      payment: {
        ...input.quote.payment,
        discounts: [...input.quote.payment.discounts],
      },
    },
    acceptedTotal: input.quote.summary.total,
    ...(input.submittedCode && { submittedCode: input.submittedCode }),
    ...(input.changedKeys && {
      changedKeys: {
        sectionKeys: [...input.changedKeys.sectionKeys],
        itemKeys: [...input.changedKeys.itemKeys],
      },
    }),
  }).pipe(Effect.mapError(toPayStateTokenError));
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
