import { Schema } from "effect";
import {
  type WorkspaceProductIdentity,
  workspaceProductIdentitySchema,
} from "@/features/checkout/product-identity";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import {
  type Money,
  nonNegativeMoneyCodec,
  positiveMoneyCodec,
} from "@/shared/money/money";
import { instantStringSchema } from "@/shared/utils/temporal";

export const discountIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("DiscountId")
).annotate({
  identifier: "DiscountId",
  description: "Deterministic opaque public discount identifier.",
});

export type DiscountId = Schema.Schema.Type<typeof discountIdSchema>;

export const canonicalPromotionCodeSchema = Schema.String.check(
  Schema.isPattern(/^[A-Z0-9][A-Z0-9_-]{2,63}$/)
)
  .pipe(Schema.brand("CanonicalPromotionCode"))
  .annotate({
    identifier: "CanonicalPromotionCode",
    description:
      "Canonical ASCII-uppercase promotion code accepted by Workspace checkout.",
  });

export type CanonicalPromotionCode = Schema.Schema.Type<
  typeof canonicalPromotionCodeSchema
>;

export const discountBasisPointsSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 10_000 })
).annotate({
  identifier: "DiscountBasisPoints",
  description: "An exact percentage discount measured in basis points.",
});

export type DiscountAdjustment =
  | {
      readonly kind: "percentage";
      readonly basisPoints: number;
    }
  | {
      readonly kind: "fixed";
      readonly amount: Money;
    };

export const discountAdjustmentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("percentage"),
    basisPoints: discountBasisPointsSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("fixed"),
    amount: positiveMoneyCodec,
  }),
]).annotate({
  identifier: "DiscountAdjustment",
  description: "A valid percentage or fixed-money discount adjustment.",
});

export type Discount = {
  readonly id: DiscountId;
  /** The label in the checkout locale, shown to the customer. */
  readonly label: string;
  /**
   * The label in `staffLocale`, written to staff-facing records such as the
   * Dotypos reservation note. It stays out of the quote fingerprint, so it
   * never causes `pricing_changed`. Pay states and accounting snapshots
   * signed before it existed lack it; staff then read `label`.
   */
  readonly staffLabel?: string;
  readonly adjustment: DiscountAdjustment;
  readonly expiresAt?: string;
  readonly countdownStartsAt?: string;
};

export type ActiveSale = {
  readonly discount: Discount;
  readonly products: readonly WorkspaceProductTarget[];
};

export type ActiveSaleDiscoveryInput = {
  readonly locale: Locale;
};

export const discountCodec = Schema.Struct({
  id: discountIdSchema,
  label: Schema.NonEmptyString,
  staffLabel: Schema.optionalKey(Schema.NonEmptyString),
  adjustment: discountAdjustmentSchema,
  expiresAt: Schema.optionalKey(Schema.toEncoded(instantStringSchema)),
  countdownStartsAt: Schema.optionalKey(Schema.toEncoded(instantStringSchema)),
}).annotate({
  identifier: "Discount",
  description: "A source-neutral discount exposed to checkout consumers.",
});

export type AppliedDiscount = {
  readonly discount: Discount;
  readonly subtotalBefore: Money;
  readonly amount: Money;
  readonly subtotalAfter: Money;
};

export const appliedDiscountCodec = Schema.Struct({
  discount: discountCodec,
  subtotalBefore: nonNegativeMoneyCodec,
  amount: positiveMoneyCodec,
  subtotalAfter: nonNegativeMoneyCodec,
}).annotate({
  identifier: "AppliedDiscount",
  description:
    "An immutable discount application and its before, applied, and after amounts.",
});

export type DiscountQuote = {
  readonly product: WorkspaceProductIdentity;
  readonly discountableSubtotal: Money;
  readonly discounts: readonly AppliedDiscount[];
  readonly totalDiscount: Money;
  readonly discountedSubtotal: Money;
};

export const discountQuoteCodec = Schema.Struct({
  product: workspaceProductIdentitySchema,
  discountableSubtotal: nonNegativeMoneyCodec,
  discounts: Schema.Array(appliedDiscountCodec),
  totalDiscount: nonNegativeMoneyCodec,
  discountedSubtotal: nonNegativeMoneyCodec,
}).annotate({
  identifier: "DiscountQuote",
  description: "A source-neutral discount calculation for one product.",
});

export const discountAdvertisementQuoteCodec = discountQuoteCodec
  .pipe(Schema.brand("DiscountAdvertisementQuote"))
  .annotate({
    identifier: "DiscountAdvertisementQuote",
    description:
      "A discount quote produced only by anonymous advertisement discovery or affirmation.",
  });

export type DiscountAdvertisementQuote =
  typeof discountAdvertisementQuoteCodec.Type;

export const affirmedDiscountAdvertisementQuoteCodec =
  discountAdvertisementQuoteCodec
    .pipe(Schema.brand("AffirmedDiscountAdvertisementQuote"))
    .annotate({
      identifier: "AffirmedDiscountAdvertisementQuote",
      description:
        "An anonymous advertisement quote freshly affirmed at reservation submission.",
    });

export type AffirmedDiscountAdvertisementQuote =
  typeof affirmedDiscountAdvertisementQuoteCodec.Type;

export type DiscountAdvertisementInput = {
  readonly product: WorkspaceProductIdentity;
  readonly discountableSubtotal: Money;
  /**
   * Last date the reservation uses the workspace. Calendar sales apply only
   * when it is on or before the sale's last day.
   */
  readonly lastServiceDate: string;
  /**
   * Prague date the reservation starts. Discount-code service-date windows
   * are judged on it; later days of the reservation never count.
   */
  readonly firstServiceDate: string;
  /** Moment the booking is made; calendar sales are evaluated at it. */
  readonly bookedAt: Temporal.Instant;
  readonly locale: Locale;
};

export type DiscountQuoteInput = {
  readonly product: WorkspaceProductIdentity;
  readonly discountableSubtotal: Money;
  /**
   * Last date the reservation uses the workspace. Calendar sales apply only
   * when it is on or before the sale's last day.
   */
  readonly lastServiceDate: string;
  /**
   * Prague date the reservation starts. Discount-code service-date windows
   * are judged on it; later days of the reservation never count.
   */
  readonly firstServiceDate: string;
  /** Moment the booking is made; calendar sales are evaluated at it. */
  readonly bookedAt: Temporal.Instant;
  readonly locale: Locale;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly submittedCode?: CanonicalPromotionCode;
  /** Referral code the checkout carries for an unattributed customer. */
  readonly referralCode?: CanonicalPromotionCode;
};
