import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  Data,
  Effect,
  Schema as EffectSchema,
  Option,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import { z } from "zod/v4";
import type {
  CheckoutSummaryChangedKeys,
  WorkspaceCheckoutOrder,
  WorkspaceCheckoutQuote,
} from "@/features/checkout/checkout-quote";
import { checkoutReturnStateJsonSchema } from "@/features/checkout/schemas/checkout-return-state";
import { checkoutSummarySchema } from "@/features/checkout/schemas/checkout-summary";
import { nonNegativeWorkspaceMoneySchema } from "@/features/checkout/workspace-money";
import { type Locale, locales } from "@/features/i18n";

export const payStateSchemaVersion = 1 as const;
export const payStateAlgorithm = "A256GCM" as const;
export const payStateTokenQueryParam = "payState" as const;
export const payStateDefaultTtlMilliseconds = 10 * 60 * 1000;

const payStateTokenPrefix = "dhp1" as const;
const ivByteLength = 12;
const authTagByteLength = 16;
const keyByteLength = 32;

const checkoutOrderSchema = z.object({
  entryTier: z.string().min(1),
  coffee: z.boolean(),
  monitorOption: z.string().min(1).optional(),
});

const quoteSnapshotSchema = z.object({
  schema: z.literal("workspace-checkout-quote"),
  schemaVersion: z.literal(1),
  fingerprint: z.string().min(1),
  order: checkoutOrderSchema,
  summary: checkoutSummarySchema,
  payment: z.object({
    expectedPrice: nonNegativeWorkspaceMoneySchema,
    undiscountedPrice: nonNegativeWorkspaceMoneySchema.optional(),
    customerDiscount: z
      .object({
        source: z.literal("dotypos-discount-group"),
        discountGroupId: z.string().min(1),
        percent: z.number().positive().max(100),
        amount: nonNegativeWorkspaceMoneySchema,
      })
      .optional(),
  }),
});

const changedKeysSchema = z.object({
  sectionKeys: z.array(z.string()),
  itemKeys: z.array(z.string()),
});

export const signedPayStateSchema = z.object({
  type: z.literal("signedPayState"),
  schema: z.literal("workspace-pay-state"),
  schemaVersion: z.literal(payStateSchemaVersion),
  alg: z.literal(payStateAlgorithm),
  kid: z.string().min(1),
  iat: z.int().nonnegative(),
  exp: z.int().positive(),
  locale: z.enum(locales),
  orderId: z.string().min(1),
  reservation: checkoutReturnStateJsonSchema.shape.reservation,
  quote: quoteSnapshotSchema,
  acceptedTotal: nonNegativeWorkspaceMoneySchema,
  changedKeys: changedKeysSchema.optional(),
});

export const retryPayStateSchema = z.object({
  type: z.literal("retryPayState"),
  schema: z.literal("workspace-pay-state"),
  schemaVersion: z.literal(payStateSchemaVersion),
  checkoutToken: z.string().min(1),
  paymentOrderId: z.string().min(1),
  stateSemantics: z.literal("checkout-return-state-token"),
  repositorySemantics: z.object({
    repository: z.literal("CheckoutReturnStateTokenRepository"),
    opaque: z.literal(true),
    singleUse: z.literal(true),
    ttlSeconds: z.literal(600),
    boundToPaymentOrderId: z.literal(true),
  }),
});

export const payStateSchema = z.discriminatedUnion("type", [
  signedPayStateSchema,
  retryPayStateSchema,
]);

export type SignedPayState = z.infer<typeof signedPayStateSchema>;
export type RetryPayState = z.infer<typeof retryPayStateSchema>;
export type PayState = z.infer<typeof payStateSchema>;

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
    | "expired"
    | "unsupported-version";
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

const getProtectedHeader = (kid: string) => ({
  v: payStateSchemaVersion,
  alg: payStateAlgorithm,
  kid,
});

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
  const state: SignedPayState = {
    type: "signedPayState",
    schema: "workspace-pay-state",
    schemaVersion: payStateSchemaVersion,
    alg: payStateAlgorithm,
    kid: activeKey.kid,
    iat,
    exp,
    locale: input.locale,
    orderId: input.orderId,
    reservation: input.reservation,
    quote: {
      schema: input.quote.schema,
      schemaVersion: input.quote.schemaVersion,
      fingerprint: input.quote.fingerprint,
      order: input.quote.order,
      summary: checkoutSummarySchema.parse(
        JSON.parse(JSON.stringify(input.quote.summary))
      ),
      payment: input.quote.payment,
    },
    acceptedTotal: input.quote.summary.total,
    ...(input.changedKeys && {
      changedKeys: {
        sectionKeys: [...input.changedKeys.sectionKeys],
        itemKeys: [...input.changedKeys.itemKeys],
      },
    }),
  };

  return signedPayStateSchema.parse(state);
};

export const buildRetryPayState = (input: {
  readonly paymentOrderId: string;
  readonly checkoutToken: string;
}): RetryPayState =>
  retryPayStateSchema.parse({
    type: "retryPayState",
    schema: "workspace-pay-state",
    schemaVersion: payStateSchemaVersion,
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

const sealPayStateRaw = (
  state: SignedPayState,
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
    payStateTokenPrefix,
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
  const [prefix, encodedHeader, encodedIv, encodedCiphertext, encodedAuthTag] =
    tokenParts;
  if (
    tokenParts.length !== 5 ||
    prefix !== payStateTokenPrefix ||
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

  const header = z
    .object({
      v: z.literal(payStateSchemaVersion),
      alg: z.literal(payStateAlgorithm),
      kid: z.string().min(1),
    })
    .safeParse(parsedHeader);

  if (!header.success) {
    throw new PayStateTokenError({
      code: "unsupported-version",
      message: "Unsupported Pay state token header.",
    });
  }

  const key = getPayStateKeyByKid(header.data.kid, options);
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

  const state = signedPayStateSchema.safeParse(parsedPlaintext);
  if (!state.success || state.data.kid !== header.data.kid) {
    throw new PayStateTokenError({
      code: "unsupported-version",
      message: "Unsupported Pay state payload.",
    });
  }

  if (state.data.exp <= Math.floor(getNowMilliseconds(options) / 1000)) {
    throw new PayStateTokenError({
      code: "expired",
      message: "Pay state token expired.",
    });
  }

  return state.data;
};

const SignedPayStateEffectSchema: EffectSchema.Codec<
  SignedPayState,
  SignedPayState
> = EffectSchema.declare(
  (input: unknown): input is SignedPayState =>
    signedPayStateSchema.safeParse(input).success,
  {
    identifier: "SignedPayState",
    description: "Workspace checkout Pay state payload.",
  }
);

export const makePayStateTokenSchema = (
  options: PayStateCryptoOptions = {}
): EffectSchema.Codec<SignedPayState, string> =>
  EffectSchema.String.pipe(
    EffectSchema.decodeTo(SignedPayStateEffectSchema, {
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
      encode: SchemaGetter.transformOrFail((state: SignedPayState) =>
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
) => EffectSchema.encodeSync(makePayStateTokenSchema(options))(state);

export const openPayState = (
  token: string,
  options: PayStateCryptoOptions = {}
): SignedPayState =>
  EffectSchema.decodeSync(makePayStateTokenSchema(options))(token);

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
