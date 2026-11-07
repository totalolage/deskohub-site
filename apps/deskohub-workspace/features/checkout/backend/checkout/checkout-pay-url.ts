import { Effect } from "effect";
import type { DiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import {
  type BuildSignedPayStateInput,
  buildSignedPayState,
  type PayStateLinkOptions,
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

/**
 * A freshly signed Pay state: its sealed token, the Pay URL built from that
 * token, and the instant the Pay page stops accepting it. Callers that hand
 * the token to a non-browser client use the same seal as the URL, never a
 * second one.
 */
export type IssuedPayState = {
  readonly payStateToken: string;
  readonly payUrl: string;
  readonly expiresAt: string;
};

export const issueFreshPayState = Effect.fn("issueFreshPayState")(function* (
  input: BuildSignedPayStateInput,
  options: PayStateLinkOptions = {},
  pathOptions: CheckoutPayPathOptions = {}
) {
  const freshState = yield* buildSignedPayState(input, options);
  const sealedState = yield* sealPayStateForUrl(freshState, options);
  const issued: IssuedPayState = {
    payStateToken: sealedState.token,
    payUrl: buildCheckoutPayPath(input.locale, sealedState, pathOptions),
    expiresAt: getPayStateExpiresAt(freshState),
  };
  return issued;
});

/** The instant the Pay page stops accepting a signed state. */
export const getPayStateExpiresAt = (state: Pick<SignedPayState, "exp">) =>
  temporalInstantToIsoString(
    Temporal.Instant.fromEpochMilliseconds(state.exp * 1000)
  );

/**
 * The Pay state a customer continues with after reviewing a price change:
 * the same signed order without its changed keys.
 */
export const issuePayStateContinuation = Effect.fn("issuePayStateContinuation")(
  (state: SignedPayState, options: PayStateLinkOptions = {}) =>
    issueFreshPayState({ ...state, changedKeys: undefined }, options)
);

export const buildFreshCheckoutPayPath = Effect.fn("buildFreshCheckoutPayPath")(
  (
    input: BuildSignedPayStateInput,
    options: PayStateLinkOptions = {},
    pathOptions: CheckoutPayPathOptions = {}
  ) =>
    issueFreshPayState(input, options, pathOptions).pipe(
      Effect.map(({ payUrl }) => payUrl)
    )
);

export const buildCheckoutPayContinuationPath = Effect.fn(
  "buildCheckoutPayContinuationPath"
)((state: SignedPayState, options: PayStateLinkOptions = {}) =>
  issuePayStateContinuation(state, options).pipe(
    Effect.map(({ payUrl }) => payUrl)
  )
);
