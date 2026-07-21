import {
  Data,
  Effect,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import { workspaceAdvertisedPriceReservationSchema } from "@/features/checkout/advertised-price";
import { workspaceCheckoutQuoteSchema } from "@/features/checkout/checkout-quote";
import { type Locale, locales } from "@/features/i18n";
import {
  type CheckoutStateCryptoOptions,
  CheckoutStateTokenError,
  getCheckoutStateKeys,
  getCheckoutStateNowMilliseconds,
  openCheckoutState,
  sealCheckoutState,
} from "./checkout-state-token";

export const advertisedPriceStateDefaultTtlMilliseconds = 10 * 60 * 1000;

const nonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const positiveIntSchema = Schema.Int.check(Schema.isGreaterThan(0));

export const advertisedPriceStateSchema = Schema.Struct({
  kid: Schema.NonEmptyString,
  iat: nonNegativeIntSchema,
  exp: positiveIntSchema,
  locale: Schema.Literals(locales),
  reservation: workspaceAdvertisedPriceReservationSchema,
  quote: workspaceCheckoutQuoteSchema,
  identifiedPricing: Schema.Literal("not_evaluated"),
}).annotate({
  identifier: "AdvertisedPriceState",
  description:
    "PII-free Workspace price advertisement state protected for reservation submission.",
});

export type AdvertisedPriceState = typeof advertisedPriceStateSchema.Type;
type EncodedAdvertisedPriceState = typeof advertisedPriceStateSchema.Encoded;

export type AdvertisedPriceStateCryptoOptions = CheckoutStateCryptoOptions;

export class AdvertisedPriceStateTokenError extends Data.TaggedError(
  "AdvertisedPriceStateTokenError"
)<{
  readonly code: CheckoutStateTokenError["code"];
  readonly message: string;
  readonly cause?: unknown;
}> {}

const protectedHeaderSchema = Schema.Struct({ kid: Schema.NonEmptyString });
const decodeProtectedHeader = Schema.decodeUnknownOption(
  protectedHeaderSchema,
  { onExcessProperty: "error" }
);
const decodeAdvertisedPriceState = Schema.decodeUnknownOption(
  advertisedPriceStateSchema,
  { onExcessProperty: "error" }
);

const toAdvertisedPriceStateTokenError = (cause: unknown) =>
  cause instanceof CheckoutStateTokenError
    ? new AdvertisedPriceStateTokenError({
        code: cause.code,
        message: cause.message,
        cause,
      })
    : new AdvertisedPriceStateTokenError({
        code: "invalid-token",
        message: "Invalid advertised price state token.",
        cause,
      });

export const buildAdvertisedPriceState = (
  input: {
    readonly locale: Locale;
    readonly reservation: AdvertisedPriceState["reservation"];
    readonly quote: AdvertisedPriceState["quote"];
    readonly ttlMilliseconds?: number;
  },
  options: AdvertisedPriceStateCryptoOptions = {}
): AdvertisedPriceState => {
  let activeKey: ReturnType<typeof getCheckoutStateKeys>[number] | undefined;
  try {
    [activeKey] = getCheckoutStateKeys(options);
  } catch (cause) {
    throw toAdvertisedPriceStateTokenError(cause);
  }
  if (!activeKey) {
    throw new AdvertisedPriceStateTokenError({
      code: "missing-secret",
      message: "At least one advertised price state key is required.",
    });
  }

  const nowMilliseconds = getCheckoutStateNowMilliseconds(options);
  return advertisedPriceStateSchema.make({
    kid: activeKey.kid,
    iat: Math.floor(nowMilliseconds / 1000),
    exp: Math.floor(
      (nowMilliseconds +
        (input.ttlMilliseconds ?? advertisedPriceStateDefaultTtlMilliseconds)) /
        1000
    ),
    locale: input.locale,
    reservation: input.reservation,
    quote: input.quote,
    identifiedPricing: "not_evaluated",
  });
};

const stateSchemaIssue = (actual: unknown, message: string) =>
  new SchemaIssue.InvalidValue(Option.some(actual), { message });

export const makeAdvertisedPriceStateTokenSchema = (
  options: AdvertisedPriceStateCryptoOptions = {}
): Schema.Codec<AdvertisedPriceState, string> =>
  Schema.String.pipe(
    Schema.decodeTo(advertisedPriceStateSchema, {
      decode: SchemaGetter.transformOrFail((token: string) =>
        Effect.try({
          try: () =>
            openCheckoutState(
              token,
              (value) => Option.getOrUndefined(decodeProtectedHeader(value)),
              (value) =>
                Option.getOrUndefined(decodeAdvertisedPriceState(value)),
              options
            ),
          catch: (cause) => {
            const error = toAdvertisedPriceStateTokenError(cause);
            return stateSchemaIssue(token, error.message);
          },
        })
      ),
      encode: SchemaGetter.transformOrFail(
        (state: EncodedAdvertisedPriceState) =>
          Effect.try({
            try: () => sealCheckoutState(state, options),
            catch: (cause) => {
              const error = toAdvertisedPriceStateTokenError(cause);
              return stateSchemaIssue(state, error.message);
            },
          })
      ),
    })
  ).annotate({
    identifier: "AdvertisedPriceStateToken",
    description:
      "AES-GCM protected PII-free Workspace advertised price snapshot.",
  });

export const sealAdvertisedPriceState = (
  state: AdvertisedPriceState,
  options: AdvertisedPriceStateCryptoOptions = {}
) =>
  Schema.encodeUnknownSync(makeAdvertisedPriceStateTokenSchema(options), {
    onExcessProperty: "error",
  })(state);

export const openAdvertisedPriceState = (
  token: string,
  options: AdvertisedPriceStateCryptoOptions = {}
): AdvertisedPriceState =>
  Schema.decodeSync(makeAdvertisedPriceStateTokenSchema(options))(token);
