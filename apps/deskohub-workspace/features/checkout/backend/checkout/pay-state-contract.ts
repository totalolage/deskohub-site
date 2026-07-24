import { Schema } from "effect";
import {
  type CheckoutSummaryChangedKeys,
  checkoutSummaryChangedKeysSchema,
} from "@/features/checkout/checkout-quote";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import {
  type CanonicalDiscountCode,
  canonicalDiscountCodeSchema,
  type DiscountId,
  discountIdSchema,
} from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { locales } from "@/features/i18n";
import { unixTimestampSecondsSchema } from "@/shared/utils/temporal";

export const signedPayStateEnvelopeSchema = Schema.Struct({
  kid: Schema.NonEmptyString,
  iat: unixTimestampSecondsSchema,
  exp: unixTimestampSecondsSchema,
  locale: Schema.Literals(locales),
  orderId: Schema.NonEmptyString,
  checkoutSessionId: Schema.optional(Schema.NonEmptyString),
  acceptedTotal: nonNegativeWorkspaceMoneyCodec,
  submittedCode: Schema.optional(canonicalDiscountCodeSchema),
  submittedCodeDiscountId: Schema.optional(discountIdSchema),
  changedKeys: Schema.optional(checkoutSummaryChangedKeysSchema),
});

export type SignedPayStateEnvelope = typeof signedPayStateEnvelopeSchema.Type;

type BuildSignedPayStateBaseInput = {
  readonly locale: Locale;
  readonly orderId: string;
  readonly checkoutSessionId?: string;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly ttlMilliseconds?: number;
};

type BuildSignedPayStateCodeInput =
  | {
      readonly submittedCode?: never;
      readonly submittedCodeDiscountId?: never;
    }
  | {
      readonly submittedCode: CanonicalDiscountCode;
      readonly submittedCodeDiscountId: DiscountId;
    };

export type BuildSignedPayStateCommonInput = BuildSignedPayStateBaseInput &
  BuildSignedPayStateCodeInput;

export const buildSignedPayStateEnvelope = (
  envelope: Omit<
    SignedPayStateEnvelope,
    | "acceptedTotal"
    | "checkoutSessionId"
    | "submittedCode"
    | "submittedCodeDiscountId"
    | "changedKeys"
  >,
  input: BuildSignedPayStateCommonInput,
  acceptedTotal: SignedPayStateEnvelope["acceptedTotal"]
): SignedPayStateEnvelope => ({
  ...envelope,
  acceptedTotal,
  ...(input.checkoutSessionId !== undefined && {
    checkoutSessionId: input.checkoutSessionId,
  }),
  ...(input.submittedCode !== undefined && {
    submittedCode: input.submittedCode,
  }),
  ...(input.submittedCodeDiscountId !== undefined && {
    submittedCodeDiscountId: input.submittedCodeDiscountId,
  }),
  ...(input.changedKeys !== undefined && {
    changedKeys: {
      sectionKeys: [...input.changedKeys.sectionKeys],
      itemKeys: [...input.changedKeys.itemKeys],
    },
  }),
});
