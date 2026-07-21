import {
  Data,
  Effect,
  Match,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import {
  type CheckoutSummaryChangedKeys,
  checkoutSummaryChangedKeysSchema,
  type WorkspaceCheckoutQuote,
  workspaceCheckoutQuoteSchema,
} from "@/features/checkout/checkout-quote";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import {
  type CanonicalDiscountCode,
  canonicalDiscountCodeSchema,
} from "@/features/discounts/contracts";
import { type Locale, locales } from "@/features/i18n";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import {
  type CheckoutStateCryptoOptions,
  type CheckoutStateKey,
  CheckoutStateTokenError,
  getCheckoutStateKeys,
  getCheckoutStateNowMilliseconds,
  openCheckoutState,
  parseCheckoutStateKey,
  sealCheckoutState,
} from "./checkout-state-token";

export const payStateTokenQueryParam = "payState" as const;
export const payStateDefaultTtlMilliseconds = 10 * 60 * 1000;

const nonEmptyStringSchema = Schema.String.check(Schema.isNonEmpty());
const nonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const positiveIntSchema = Schema.Int.check(Schema.isGreaterThan(0));

export const signedPayStateSchema = Schema.Struct({
  kid: nonEmptyStringSchema,
  iat: nonNegativeIntSchema,
  exp: positiveIntSchema,
  locale: Schema.Literals(locales),
  orderId: nonEmptyStringSchema,
  reservation: normalizedCoworkReservationOrderSchema,
  quote: workspaceCheckoutQuoteSchema,
  acceptedTotal: nonNegativeWorkspaceMoneyCodec,
  submittedCode: Schema.optional(canonicalDiscountCodeSchema),
  changedKeys: Schema.optional(checkoutSummaryChangedKeysSchema),
}).annotate({
  identifier: "SignedPayState",
  description: "Workspace checkout Pay state payload.",
});

export type SignedPayState = typeof signedPayStateSchema.Type;
type EncodedSignedPayState = typeof signedPayStateSchema.Encoded;

export type PayStateKey = CheckoutStateKey;
export type PayStateCryptoOptions = CheckoutStateCryptoOptions;

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
  readonly submittedCode?: CanonicalDiscountCode;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly ttlMilliseconds?: number;
};

export class PayStateTokenError extends Data.TaggedError("PayStateTokenError")<{
  readonly code:
    | "missing-secret"
    | "invalid-secret"
    | "invalid-token"
    | "unknown-kid"
    | "expired";
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
        message: "Invalid Pay state token.",
        cause,
      });

export const parsePayStateKey = (
  kid: string,
  base64UrlKey: string
): PayStateKey => {
  try {
    return parseCheckoutStateKey(kid, base64UrlKey);
  } catch (cause) {
    throw toPayStateTokenError(cause);
  }
};

export const buildSignedPayState = (
  input: BuildSignedPayStateInput,
  options: PayStateCryptoOptions = {}
): SignedPayState => {
  let activeKey: CheckoutStateKey | undefined;
  try {
    [activeKey] = getCheckoutStateKeys(options);
  } catch (cause) {
    throw toPayStateTokenError(cause);
  }
  if (!activeKey) {
    throw new PayStateTokenError({
      code: "missing-secret",
      message: "At least one Pay state encryption key is required.",
    });
  }

  const nowMilliseconds = getCheckoutStateNowMilliseconds(options);
  const iat = Math.floor(nowMilliseconds / 1000);
  const exp = Math.floor(
    (nowMilliseconds +
      (input.ttlMilliseconds ?? payStateDefaultTtlMilliseconds)) /
      1000
  );
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
  const state: SignedPayState = {
    kid: activeKey.kid,
    iat,
    exp,
    locale: input.locale,
    orderId: input.orderId,
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
  };

  return state;
};

const payStateSchemaIssue = (actual: unknown, message: string) =>
  new SchemaIssue.InvalidValue(Option.some(actual), { message });

const protectedHeaderSchema = Schema.Struct({ kid: nonEmptyStringSchema });
const decodeProtectedHeader = Schema.decodeUnknownOption(
  protectedHeaderSchema,
  { onExcessProperty: "error" }
);
const decodeSignedPayStateOption = Schema.decodeUnknownOption(
  signedPayStateSchema,
  { onExcessProperty: "error" }
);

const sealPayStateRaw = (
  state: EncodedSignedPayState,
  options: PayStateCryptoOptions = {}
) => {
  try {
    return sealCheckoutState(state, options);
  } catch (cause) {
    throw toPayStateTokenError(cause);
  }
};

const openPayStateRaw = (
  token: string,
  options: PayStateCryptoOptions = {}
): SignedPayState => {
  try {
    return openCheckoutState(
      token,
      (value) => Option.getOrUndefined(decodeProtectedHeader(value)),
      (value) => Option.getOrUndefined(decodeSignedPayStateOption(value)),
      options
    );
  } catch (cause) {
    throw toPayStateTokenError(cause);
  }
};

export const makePayStateTokenSchema = (
  options: PayStateCryptoOptions = {}
): Schema.Codec<SignedPayState, string> =>
  Schema.String.pipe(
    Schema.decodeTo(signedPayStateSchema, {
      decode: SchemaGetter.transformOrFail((token: string) =>
        Effect.try({
          try: () => openPayStateRaw(token, options),
          catch: (error) =>
            payStateSchemaIssue(
              token,
              error instanceof Error
                ? error.message
                : "Invalid Pay state token."
            ),
        })
      ),
      encode: SchemaGetter.transformOrFail((state: EncodedSignedPayState) =>
        Effect.try({
          try: () => sealPayStateRaw(state, options),
          catch: (error) =>
            payStateSchemaIssue(
              state,
              error instanceof Error
                ? error.message
                : "Pay state could not be sealed."
            ),
        })
      ),
    })
  ).annotate({
    identifier: "PayStateToken",
    description:
      "AES-GCM encrypted URL token for Workspace checkout Pay state.",
  });

export const sealPayState = (
  state: SignedPayState,
  options: PayStateCryptoOptions = {}
) =>
  Schema.encodeUnknownSync(makePayStateTokenSchema(options), {
    onExcessProperty: "error",
  })(state);

export const openPayState = Effect.fn("payState.open")(
  (token: string, options: PayStateCryptoOptions = {}) =>
    Schema.decodeUnknownEffect(makePayStateTokenSchema(options))(token)
);

export const sealPayStateForUrl = (
  state: SignedPayState,
  options: PayStateCryptoOptions = {}
): SealPayStateForUrlResult => {
  const token = sealPayState(state, options);

  return {
    type: "sealedPayState",
    token,
    queryParam: payStateTokenQueryParam,
  };
};

export const buildPayStateQueryParams = (result: SealPayStateForUrlResult) => {
  const searchParams = new URLSearchParams();
  searchParams.set(payStateTokenQueryParam, result.token);

  return searchParams;
};

export const buildPayUrl = (
  baseUrl: string | URL,
  result: SealPayStateForUrlResult
) => {
  const url = new URL(baseUrl);
  url.searchParams.set(payStateTokenQueryParam, result.token);

  return { type: "payUrl" as const, url };
};
