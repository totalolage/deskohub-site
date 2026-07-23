import { Schema } from "effect";
import { legalEvidenceMapSchema } from "@/features/checkout/legal-evidence";
import { locales } from "@/features/i18n";

export const checkoutDetailsBaseSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  legal: legalEvidenceMapSchema,
});
