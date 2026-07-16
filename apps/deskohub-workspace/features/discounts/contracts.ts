import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import {
  type WorkspaceProductTier,
  workspaceProductTiers,
} from "@/features/checkout/product-catalog";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { positiveWorkspaceMoneyEffectSchema } from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";

export type DiscountProductIdentity = {
  readonly kind: "cowork";
  readonly tier: WorkspaceProductTier;
};

export const discountIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("DiscountId")
).annotate({
  identifier: "DiscountId",
  description: "Deterministic opaque public discount identifier.",
});

export type DiscountId = Schema.Schema.Type<typeof discountIdSchema>;

export const discountBasisPointsEffectSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 10_000 })
).annotate({
  identifier: "DiscountBasisPoints",
  description: "An exact percentage discount measured in basis points.",
});

export const discountProductIdentityEffectSchema = Schema.Struct({
  kind: Schema.Literal("cowork"),
  tier: Schema.Literals(workspaceProductTiers),
});

export const discountProductIdentitySchema: StandardSchemaV1<
  unknown,
  DiscountProductIdentity
> = Schema.toStandardSchemaV1(discountProductIdentityEffectSchema, {
  parseOptions: {
    onExcessProperty: "error",
  },
});

export type DiscountAdjustment =
  | {
      readonly kind: "percentage";
      readonly basisPoints: number;
    }
  | {
      readonly kind: "fixed";
      readonly amount: WorkspaceMoney;
    };

export const discountAdjustmentEffectSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("percentage"),
    basisPoints: discountBasisPointsEffectSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("fixed"),
    amount: positiveWorkspaceMoneyEffectSchema,
  }),
]).annotate({
  identifier: "DiscountAdjustment",
  description: "A valid percentage or fixed-money discount adjustment.",
});

export type Discount = {
  readonly id: DiscountId;
  readonly label: string;
  readonly adjustment: DiscountAdjustment;
  readonly expiresAt?: string;
  readonly countdownStartsAt?: string;
};

export type AppliedDiscount = {
  readonly discount: Discount;
  readonly subtotalBefore: WorkspaceMoney;
  readonly amount: WorkspaceMoney;
  readonly subtotalAfter: WorkspaceMoney;
};

export type DiscountQuote = {
  readonly product: DiscountProductIdentity;
  readonly discountableSubtotal: WorkspaceMoney;
  readonly discounts: readonly AppliedDiscount[];
  readonly totalDiscount: WorkspaceMoney;
  readonly discountedSubtotal: WorkspaceMoney;
};

export type DiscountQuoteInput = {
  readonly product: DiscountProductIdentity;
  readonly discountableSubtotal: WorkspaceMoney;
  readonly reservationDate: string;
  readonly dotyposCustomerId: string;
  readonly locale: Locale;
  readonly submittedCode: string | undefined;
};
