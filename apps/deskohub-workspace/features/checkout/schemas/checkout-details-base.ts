import { Schema } from "effect";
import { legalEvidenceMapSchema } from "@/features/checkout/legal-evidence";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import { appliedDiscountCodec } from "@/features/discounts/contracts";
import { locales } from "@/features/i18n";

export const checkoutDetailsBaseSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  legal: legalEvidenceMapSchema,
});

export const checkoutPaymentBaseSchema = Schema.Struct({
  expectedPrice: nonNegativeWorkspaceMoneyCodec,
  undiscountedPrice: nonNegativeWorkspaceMoneyCodec,
  discounts: Schema.Array(appliedDiscountCodec),
});
