import { Schema } from "effect";
import { workspaceMeetingRoomDurationOptions } from "@/features/checkout/product-catalog";
import {
  nonNegativeWorkspaceMoneyEffectSchema,
  workspaceMoneyEffectSchema,
} from "@/features/checkout/workspace-money";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";

export const checkoutSummaryItemEffectSchema = Schema.Struct({
  key: Schema.NonEmptyString,
  amount: workspaceMoneyEffectSchema,
  meetingRoomDurationMinutes: Schema.optional(
    Schema.Literals(workspaceMeetingRoomDurationOptions)
  ),
});

export const checkoutSummarySectionEffectSchema = Schema.Union([
  Schema.Struct({
    key: Schema.Literal("order"),
    items: Schema.Array(
      Schema.Struct({
        ...checkoutSummaryItemEffectSchema.fields,
        amount: nonNegativeWorkspaceMoneyEffectSchema,
      })
    ),
    total: nonNegativeWorkspaceMoneyEffectSchema,
  }),
  Schema.Struct({
    key: Schema.Literal("discount"),
    items: Schema.Array(checkoutSummaryItemEffectSchema),
    total: workspaceMoneyEffectSchema,
  }),
  Schema.Struct({
    key: Schema.Literal("total"),
    items: Schema.Array(
      Schema.Struct({
        ...checkoutSummaryItemEffectSchema.fields,
        amount: nonNegativeWorkspaceMoneyEffectSchema,
      })
    ),
    total: nonNegativeWorkspaceMoneyEffectSchema,
  }),
]);

export const checkoutSummaryEffectSchema = Schema.Struct({
  sections: Schema.Array(checkoutSummarySectionEffectSchema),
  total: nonNegativeWorkspaceMoneyEffectSchema,
});

export type CheckoutSummaryItem = typeof checkoutSummaryItemEffectSchema.Type;
export type CheckoutSummarySection =
  typeof checkoutSummarySectionEffectSchema.Type;
export type CheckoutSummary = typeof checkoutSummaryEffectSchema.Type;
export type CheckoutDetailsPaymentSummary = {
  readonly sections: Array<
    CheckoutSummarySection & {
      readonly items: CheckoutSummaryItem[];
    }
  >;
  readonly total: CheckoutSummary["total"];
};

export const checkoutSummarySchema = makeEffectSchemaParser(
  checkoutSummaryEffectSchema
);

export const checkoutSummarySectionSchema = makeEffectSchemaParser(
  checkoutSummarySectionEffectSchema
);

export const isCheckoutSummarySection = (
  input: unknown
): input is CheckoutSummarySection =>
  checkoutSummarySectionSchema.safeParse(input).success;

export const toCheckoutDetailsPaymentSummary = (
  summary: CheckoutSummary
): CheckoutDetailsPaymentSummary => ({
  sections: summary.sections.map((section) => ({
    ...section,
    items: [...section.items],
  })),
  total: summary.total,
});
