import { Schema } from "effect";
import { locales } from "@/features/i18n";

export const preparePayStateCommonSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  checkoutSessionId: Schema.NonEmptyString,
  checkoutAttemptId: Schema.NonEmptyString,
  legalConsent: Schema.optional(Schema.Boolean),
});
