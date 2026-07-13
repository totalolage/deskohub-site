import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod/v4";
import {
  type WorkspaceProductTier,
  workspaceProductTiers,
} from "@/features/checkout/product-catalog";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";

export type DiscountProductIdentity = {
  readonly kind: "cowork";
  readonly tier: WorkspaceProductTier;
};

export const discountProductIdentitySchema: StandardSchemaV1<
  unknown,
  DiscountProductIdentity
> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("cowork"),
    tier: z.enum(workspaceProductTiers),
  }),
]);

export type DiscountAdjustment =
  | {
      readonly kind: "percentage";
      readonly basisPoints: number;
    }
  | {
      readonly kind: "fixed";
      readonly amount: WorkspaceMoney;
    };

export type Discount = {
  readonly id: string;
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
  readonly submittedCode?: string;
};
