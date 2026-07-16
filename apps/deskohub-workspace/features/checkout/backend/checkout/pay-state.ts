import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  Data,
  Effect,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import type {
  CheckoutSummaryChangedKeys,
  WorkspaceCheckoutOrder,
  WorkspaceCheckoutQuote,
} from "@/features/checkout/checkout-quote";
import { workspaceProductMonitorOptions } from "@/features/checkout/product-catalog";
import {
  nonNegativeWorkspaceMoneyCodec,
  workspaceMoneyCodec,
} from "@/features/checkout/workspace-money";
import {
  appliedDiscountCodec,
  type CanonicalDiscountCode,
  canonicalDiscountCodeSchema,
} from "@/features/discounts/contracts";
import { type Locale, locales } from "@/features/i18n";
import { reservationCustomerSchema } from "@/features/reservation/reservation-contact";
import { plainDateStringSchema } from "@/shared/utils/temporal";

export const payStateTokenQueryParam = "payState" as const;
export const payStateDefaultTtlMilliseconds = 10 * 60 * 1000;

const ivByteLength = 12;
const authTagByteLength = 16;
const keyByteLength = 32;

const strictParseOptions = { onExcessProperty: "error" } as const;
const nonEmptyStringSchema = Schema.String.check(Schema.isNonEmpty());
const nonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const positiveIntSchema = Schema.Int.check(Schema.isGreaterThan(0));
const requiredCoffeeSchema = Schema.Boolean.pipe(
  Schema.decodeTo(Schema.Literal(true), {
    decode: SchemaGetter.transform(() => true as const),
    encode: SchemaGetter.transform(() => true),
  })
);

const reservationContactFields = reservationCustomerSchema.fields;
const payStateReservationSchema = Schema.Union([
  Schema.Struct({
    entryTier: Schema.Literal("basic"),
    date: plainDateStringSchema,
    coffee: Schema.Boolean,
    monitorOption: Schema.optional(Schema.Never),
    ...reservationContactFields,
  }),
  Schema.Struct({
    entryTier: Schema.Literal("plus"),
    date: plainDateStringSchema,
    coffee: requiredCoffeeSchema,
    monitorOption: Schema.optional(Schema.Never),
    ...reservationContactFields,
  }),
  Schema.Struct({
    entryTier: Schema.Literal("profi"),
    date: plainDateStringSchema,
    coffee: requiredCoffeeSchema,
    monitorOption: Schema.Literals(workspaceProductMonitorOptions),
    ...reservationContactFields,
  }),
]).annotate({
  identifier: "PayStateReservation",
  description: "Normalized cowork reservation carried by Pay state.",
});

const checkoutOrderSchema = Schema.Union([
  Schema.Struct({
    entryTier: Schema.Literal("basic"),
    coffee: Schema.Boolean,
    monitorOption: Schema.optional(Schema.Never),
  }),
  Schema.Struct({
    entryTier: Schema.Literal("plus"),
    coffee: Schema.Literal(true),
    monitorOption: Schema.optional(Schema.Never),
  }),
  Schema.Struct({
    entryTier: Schema.Literal("profi"),
    coffee: Schema.Literal(true),
    monitorOption: Schema.Literals(workspaceProductMonitorOptions),
  }),
]).annotate({
  identifier: "PayStateCheckoutOrder",
  description: "Normalized Workspace checkout order carried by Pay state.",
});

const checkoutSummaryItemFields = {
  key: nonEmptyStringSchema,
  amount: workspaceMoneyCodec,
};
const nonNegativeCheckoutSummaryItemSchema = Schema.Struct({
  ...checkoutSummaryItemFields,
  label: Schema.optional(nonEmptyStringSchema),
  amount: nonNegativeWorkspaceMoneyCodec,
});
const checkoutSummarySchema = Schema.Struct({
  schema: Schema.Literal("workspace-checkout-summary"),
  sections: Schema.Array(
    Schema.Union([
      Schema.Struct({
        key: Schema.Literal("order"),
        items: Schema.Array(nonNegativeCheckoutSummaryItemSchema),
        total: nonNegativeWorkspaceMoneyCodec,
      }),
      Schema.Struct({
        key: Schema.Literal("discount"),
        items: Schema.Array(
          Schema.Struct({
            ...checkoutSummaryItemFields,
            label: nonEmptyStringSchema,
          })
        ),
        total: workspaceMoneyCodec,
      }),
      Schema.Struct({
        key: Schema.Literal("total"),
        items: Schema.Array(nonNegativeCheckoutSummaryItemSchema),
        total: nonNegativeWorkspaceMoneyCodec,
      }),
    ])
  ),
  total: nonNegativeWorkspaceMoneyCodec,
}).annotate({
  identifier: "PayStateCheckoutSummary",
  description: "Public checkout summary snapshot carried by Pay state.",
});

const quoteSnapshotSchema = Schema.Struct({
  schema: Schema.Literal("workspace-checkout-quote"),
  fingerprint: nonEmptyStringSchema,
  order: checkoutOrderSchema,
  summary: checkoutSummarySchema,
  payment: Schema.Struct({
    expectedPrice: nonNegativeWorkspaceMoneyCodec,
    undiscountedPrice: nonNegativeWorkspaceMoneyCodec,
    discounts: Schema.Array(appliedDiscountCodec),
  }),
}).annotate({
  identifier: "PayStateCheckoutQuote",
  description: "Authoritative checkout quote snapshot carried by Pay state.",
});

const changedKeysSchema = Schema.Struct({
  sectionKeys: Schema.Array(Schema.String),
  itemKeys: Schema.Array(Schema.String),
});

export const signedPayStateSchema = Schema.Struct({
  type: Schema.Literal("signedPayState"),
  schema: Schema.Literal("workspace-pay-state"),
  kid: nonEmptyStringSchema,
  iat: nonNegativeIntSchema,
  exp: positiveIntSchema,
  locale: Schema.Literals(locales),
  orderId: nonEmptyStringSchema,
  reservation: payStateReservationSchema,
  quote: quoteSnapshotSchema,
  acceptedTotal: nonNegativeWorkspaceMoneyCodec,
  submittedCode: Schema.optional(canonicalDiscountCodeSchema),
  changedKeys: Schema.optional(changedKeysSchema),
}).annotate({
  identifier: "SignedPayState",
  description: "Workspace checkout Pay state payload.",
});

export const retryPayStateSchema = Schema.Struct({
  type: Schema.Literal("retryPayState"),
  schema: Schema.Literal("workspace-pay-state"),
  checkoutToken: nonEmptyStringSchema,
  paymentOrderId: nonEmptyStringSchema,
  stateSemantics: Schema.Literal("checkout-return-state-token"),
  repositorySemantics: Schema.Struct({
    repository: Schema.Literal("CheckoutReturnStateTokenRepository"),
    opaque: Schema.Literal(true),
    singleUse: Schema.Literal(true),
    ttlSeconds: Schema.Literal(600),
    boundToPaymentOrderId: Schema.Literal(true),
  }),
}).annotate({
  identifier: "RetryPayState",
  description: "Opaque checkout retry state carried by Pay state.",
});

export const payStateSchema = Schema.Union([
  signedPayStateSchema,
  retryPayStateSchema,
]).annotate({
  identifier: "PayState",
  description: "Workspace checkout Pay state payload.",
});

export type SignedPayState = typeof signedPayStateSchema.Type;
type EncodedSignedPayState = typeof signedPayStateSchema.Encoded;
export type RetryPayState = typeof retryPayStateSchema.Type;
export type PayState = typeof payStateSchema.Type;

const decodeSignedPayState = Schema.decodeUnknownSync(
  signedPayStateSchema,
  strictParseOptions
);
const decodeRetryPayState = Schema.decodeUnknownSync(
  retryPayStateSchema,
  strictParseOptions
);

export type PayStateKey = {
  readonly kid: string;
  readonly key: Buffer;
};

export type PayStateCryptoOptions = {
  readonly keys?: readonly PayStateKey[];
  readonly now?: () => Date;
  readonly randomBytes?: (size: number) => Buffer;
};

export type SealPayStateForUrlResult = {
  readonly type: "sealedPayState";
  readonly token: string;
  readonly queryParam: typeof payStateTokenQueryParam;
};

export type BuildSignedPayStateInput = {
  readonly locale: Locale;
  readonly reservation: {
    readonly entryTier: WorkspaceCheckoutOrder["entryTier"];
    readonly date: string;
    readonly coffee: boolean;
    readonly monitorOption?: WorkspaceCheckoutOrder["monitorOption"];
    readonly name: string;
    readonly email: string;
    readonly phone: string;
    readonly message?: string;
  };
  readonly quote: WorkspaceCheckoutQuote;
  readonly orderId: string;
  readonly submittedCode?: CanonicalDiscountCode;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly ttlMilliseconds?: number;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const base64UrlEncode = (bytes: Buffer | Uint8Array | string) =>
  Buffer.from(bytes).toString("base64url");

const base64UrlDecode = (value: string) => Buffer.from(value, "base64url");

const getNowMilliseconds = (options: PayStateCryptoOptions = {}) =>
  (options.now?.() ?? new Date()).getTime();

const getPayStateKeysFromEnvironment = (): readonly PayStateKey[] => {
  const rawKeys = process.env.CHECKOUT_PAY_STATE_KEYS;

  if (!rawKeys) {
    throw new PayStateTokenError({
      code: "missing-secret",
      message: "CHECKOUT_PAY_STATE_KEYS is required to seal/open Pay state.",
    });
  }

  return rawKeys.split(",").map((entry) => {
    const [kid, key] = entry.split(":");
    if (!kid || !key) {
      throw new PayStateTokenError({
        code: "invalid-secret",
        message:
          "CHECKOUT_PAY_STATE_KEYS entries must be formatted as kid:base64url-32-byte-key.",
      });
    }

    return parsePayStateKey(kid, key);
  });
};

const getPayStateKeys = (options: PayStateCryptoOptions = {}) => {
  const keys = options.keys ?? getPayStateKeysFromEnvironment();
  if (keys.length === 0) {
    throw new PayStateTokenError({
      code: "missing-secret",
      message: "At least one Pay state encryption key is required.",
    });
  }

  for (const key of keys) {
    if (key.key.byteLength !== keyByteLength) {
      throw new PayStateTokenError({
        code: "invalid-secret",
        message: "Pay state encryption keys must be 32 bytes.",
      });
    }
  }

  return keys;
};

const getPayStateKeyByKid = (
  kid: string,
  options: PayStateCryptoOptions = {}
) => {
  const key = getPayStateKeys(options).find(
    (candidate) => candidate.kid === kid
  );
  if (!key) {
    throw new PayStateTokenError({
      code: "unknown-kid",
      message: "Pay state token used an unknown key id.",
    });
  }

  return key;
};

export class PayStateTokenError extends Data.TaggedError("PayStateTokenError")<{
  readonly code:
    | "missing-secret"
    | "invalid-secret"
    | "invalid-token"
    | "unknown-kid"
    | "expired";
  readonly message: string;
}> {}

export const parsePayStateKey = (
  kid: string,
  base64UrlKey: string
): PayStateKey => {
  const key = base64UrlDecode(base64UrlKey);
  if (key.byteLength !== keyByteLength) {
    throw new PayStateTokenError({
      code: "invalid-secret",
      message: "Pay state encryption keys must decode to 32 bytes.",
    });
  }

  return { kid, key };
};

const getProtectedHeader = (kid: string) => ({ kid });

export const buildSignedPayState = (
  input: BuildSignedPayStateInput,
  options: PayStateCryptoOptions = {}
): SignedPayState => {
  const [activeKey] = getPayStateKeys(options);
  if (!activeKey) {
    throw new PayStateTokenError({
      code: "missing-secret",
      message: "At least one Pay state encryption key is required.",
    });
  }

  const nowMilliseconds = getNowMilliseconds(options);
  const iat = Math.floor(nowMilliseconds / 1000);
  const exp = Math.floor(
    (nowMilliseconds +
      (input.ttlMilliseconds ?? payStateDefaultTtlMilliseconds)) /
      1000
  );
  const state = {
    type: "signedPayState",
    schema: "workspace-pay-state",
    kid: activeKey.kid,
    iat,
    exp,
    locale: input.locale,
    orderId: input.orderId,
    reservation: input.reservation,
    quote: {
      schema: input.quote.schema,
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

  return decodeSignedPayState(state);
};

export const buildRetryPayState = (input: {
  readonly paymentOrderId: string;
  readonly checkoutToken: string;
}): RetryPayState =>
  decodeRetryPayState({
    type: "retryPayState",
    schema: "workspace-pay-state",
    paymentOrderId: input.paymentOrderId,
    checkoutToken: input.checkoutToken,
    stateSemantics: "checkout-return-state-token",
    repositorySemantics: {
      repository: "CheckoutReturnStateTokenRepository",
      opaque: true,
      singleUse: true,
      ttlSeconds: 600,
      boundToPaymentOrderId: true,
    },
  });

const payStateSchemaIssue = (actual: unknown, message: string) =>
  new SchemaIssue.InvalidValue(Option.some(actual), { message });

const protectedHeaderSchema = Schema.Struct({ kid: nonEmptyStringSchema });
const decodeProtectedHeader = Schema.decodeUnknownOption(
  protectedHeaderSchema,
  strictParseOptions
);
const decodeSignedPayStateOption = Schema.decodeUnknownOption(
  signedPayStateSchema,
  strictParseOptions
);

const sealPayStateRaw = (
  state: EncodedSignedPayState,
  options: PayStateCryptoOptions = {}
) => {
  const key = getPayStateKeyByKid(state.kid, options);
  const header = getProtectedHeader(key.kid);
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const iv = options.randomBytes?.(ivByteLength) ?? randomBytes(ivByteLength);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv, {
    authTagLength: authTagByteLength,
  });

  cipher.setAAD(textEncoder.encode(encodedHeader));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(state), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    encodedHeader,
    base64UrlEncode(iv),
    base64UrlEncode(ciphertext),
    base64UrlEncode(authTag),
  ].join(".");
};

const openPayStateRaw = (
  token: string,
  options: PayStateCryptoOptions = {}
): SignedPayState => {
  const tokenParts = token.split(".");
  const [encodedHeader, encodedIv, encodedCiphertext, encodedAuthTag] =
    tokenParts;
  if (
    tokenParts.length !== 4 ||
    !encodedHeader ||
    !encodedIv ||
    !encodedCiphertext ||
    !encodedAuthTag
  ) {
    throw new PayStateTokenError({
      code: "invalid-token",
      message: "Invalid Pay state token.",
    });
  }

  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(
      textDecoder.decode(base64UrlDecode(encodedHeader))
    );
  } catch {
    throw new PayStateTokenError({
      code: "invalid-token",
      message: "Invalid Pay state token header.",
    });
  }

  const header = decodeProtectedHeader(parsedHeader);
  if (Option.isNone(header)) {
    throw new PayStateTokenError({
      code: "invalid-token",
      message: "Invalid Pay state token header.",
    });
  }

  const key = getPayStateKeyByKid(header.value.kid, options);
  let plaintext: string;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.key,
      base64UrlDecode(encodedIv),
      { authTagLength: authTagByteLength }
    );
    decipher.setAAD(textEncoder.encode(encodedHeader));
    decipher.setAuthTag(base64UrlDecode(encodedAuthTag));
    plaintext = Buffer.concat([
      decipher.update(base64UrlDecode(encodedCiphertext)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new PayStateTokenError({
      code: "invalid-token",
      message: "Invalid Pay state token.",
    });
  }

  let parsedPlaintext: unknown;
  try {
    parsedPlaintext = JSON.parse(plaintext);
  } catch {
    throw new PayStateTokenError({
      code: "invalid-token",
      message: "Invalid Pay state token payload.",
    });
  }

  const state = decodeSignedPayStateOption(parsedPlaintext);
  if (Option.isNone(state) || state.value.kid !== header.value.kid) {
    throw new PayStateTokenError({
      code: "invalid-token",
      message: "Invalid Pay state token payload.",
    });
  }

  if (state.value.exp <= Math.floor(getNowMilliseconds(options) / 1000)) {
    throw new PayStateTokenError({
      code: "expired",
      message: "Pay state token expired.",
    });
  }

  return state.value;
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
  Schema.encodeSync(
    makePayStateTokenSchema(options),
    strictParseOptions
  )(decodeSignedPayState(state));

export const openPayState = (
  token: string,
  options: PayStateCryptoOptions = {}
): SignedPayState => Schema.decodeSync(makePayStateTokenSchema(options))(token);

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
