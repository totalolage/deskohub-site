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
import { sealedStateKeyIdSchema } from "@/shared/backend/sealed-state";
import {
  type Instant,
  instantStringSchema,
  unixTimestampSecondsSchema,
} from "@/shared/utils/temporal";

export const signedPayStateEnvelopeSchema = Schema.Struct({
  kid: sealedStateKeyIdSchema,
  iat: unixTimestampSecondsSchema,
  exp: unixTimestampSecondsSchema,
  locale: Schema.Literals(locales),
  orderId: workspaceReservationIdSchema,
  bookedAt: instantStringSchema,
  checkoutSessionId: Schema.optional(checkoutSessionIdSchema),
  acceptedTotal: nonNegativeWorkspaceMoneyCodec,
  submittedCode: Schema.optional(canonicalPromotionCodeSchema),
  submittedCodeDiscountId: Schema.optional(discountIdSchema),
  requestedDiscountCode: Schema.optional(canonicalPromotionCodeSchema),
  /**
   * Referral code applied for this order. It prices the invitation while it
   * stays eligible, and its attribution is recorded only when the order is
   * paid.
   */
  referralCode: Schema.optional(canonicalPromotionCodeSchema),
  changedKeys: Schema.optional(checkoutSummaryChangedKeysSchema),
});

export type SignedPayStateEnvelope = typeof signedPayStateEnvelopeSchema.Type;

type BuildSignedPayStateBaseInput = {
  readonly locale: Locale;
  readonly orderId: typeof workspaceReservationIdSchema.Type;
  /** Moment the reservation was submitted; calendar sales are evaluated at it. */
  readonly bookedAt: Instant;
  readonly checkoutSessionId?: typeof checkoutSessionIdSchema.Type;
  readonly requestedDiscountCode?: CanonicalPromotionCode;
  readonly referralCode?: CanonicalPromotionCode;
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
    | "requestedDiscountCode"
    | "referralCode"
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
  ...(input.requestedDiscountCode !== undefined && {
    requestedDiscountCode: input.requestedDiscountCode,
  }),
  ...(input.referralCode !== undefined && {
    referralCode: input.referralCode,
  }),
  ...(input.changedKeys !== undefined && {
    changedKeys: {
      sectionKeys: [...input.changedKeys.sectionKeys],
      itemKeys: [...input.changedKeys.itemKeys],
    },
  }),
});
