import { Schema } from "effect";
import { checkoutSummarySchema } from "@/features/checkout/checkout-quote";
import { legalEvidenceMapSchema } from "@/features/checkout/legal-evidence";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import { appliedDiscountCodec } from "@/features/discounts/contracts";
import { locales } from "@/features/i18n";
import { coworkReservationDetailsSchema } from "@/features/reservation/cowork-reservation";

export const checkoutDetailsJsonSchema = Schema.Struct({
  schema: Schema.Literal("workspace-checkout-details"),
  schemaVersion: Schema.Literal(1),
  locale: Schema.Literals(locales),
  reservation: coworkReservationDetailsSchema,
  payment: Schema.Struct({
    expectedPrice: nonNegativeWorkspaceMoneyCodec,
    undiscountedPrice: nonNegativeWorkspaceMoneyCodec,
    discounts: Schema.Array(appliedDiscountCodec),
    summary: checkoutSummarySchema,
    providerRedirectUrl: Schema.optional(Schema.URL),
  }),
  legal: legalEvidenceMapSchema,
}).annotate({
  identifier: "CheckoutDetails",
  description: "Transient PII-free checkout provider snapshot.",
});

export type CheckoutDetailsJson = typeof checkoutDetailsJsonSchema.Type;
