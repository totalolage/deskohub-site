import { Schema } from "effect";
import { locales } from "@/features/i18n";

const applyDiscountCodeInputSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  payStateToken: Schema.NonEmptyString,
  submittedCode: Schema.String,
});

export const applyDiscountCodeSchema = Schema.toStandardSchemaV1(
  applyDiscountCodeInputSchema
);

export type ApplyDiscountCodeInput = typeof applyDiscountCodeInputSchema.Type;
