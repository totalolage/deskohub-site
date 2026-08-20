import { Schema } from "effect";
import type { RequireAllOrNone } from "type-fest";
import { checkoutSessionIdSchema } from "@/features/checkout/checkout-identifiers";
import {
  type CheckoutSummaryChangedKeys,
  checkoutSummaryChangedKeysSchema,
} from "@/features/checkout/checkout-summary";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
  type DiscountId,
  discountIdSchema,
} from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { locales } from "@/features/i18n";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { unixTimestampSecondsSchema } from "@/shared/utils/temporal";
import { checkoutStateKeyIdSchema } from "./checkout-state-token";

export const signedPayStateEnvelopeSchema = Schema.Struct({
  kid: checkoutStateKeyIdSchema,
  iat: unixTimestampSecondsSchema,
  exp: unixTimestampSecondsSchema,
  locale: Schema.Literals(locales),
  orderId: workspaceReservationIdSchema,
  checkoutSessionId: Schema.optional(checkoutSessionIdSchema),
  acceptedTotal: nonNegativeWorkspaceMoneyCodec,
  submittedCode: Schema.optional(canonicalPromotionCodeSchema),
  submittedCodeDiscountId: Schema.optional(discountIdSchema),
  changedKeys: Schema.optional(checkoutSummaryChangedKeysSchema),
});

export type SignedPayStateEnvelope = typeof signedPayStateEnvelopeSchema.Type;

type BuildSignedPayStateBaseInput = {
  readonly locale: Locale;
  readonly orderId: typeof workspaceReservationIdSchema.Type;
  readonly checkoutSessionId?: typeof checkoutSessionIdSchema.Type;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly ttlMilliseconds?: number;
};

export type PayStateSubmittedCodeMetadata = RequireAllOrNone<{
  readonly submittedCode: CanonicalPromotionCode;
  readonly submittedCodeDiscountId: DiscountId;
}>;

export const getSubmittedCodeMetadata = (input: {
  readonly submittedCode?: CanonicalPromotionCode;
  readonly submittedCodeDiscountId?: DiscountId;
}): PayStateSubmittedCodeMetadata =>
  input.submittedCode !== undefined &&
  input.submittedCodeDiscountId !== undefined
    ? {
        submittedCode: input.submittedCode,
        submittedCodeDiscountId: input.submittedCodeDiscountId,
      }
    : {};

export type BuildSignedPayStateCommonInput = BuildSignedPayStateBaseInput &
  PayStateSubmittedCodeMetadata;

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
