import { Schema } from "effect";
import {
  checkoutAttemptIdSchema,
  checkoutSessionIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { locales } from "@/features/i18n";

export const preparePayStateCommonSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  checkoutSessionId: checkoutSessionIdSchema,
  checkoutAttemptId: checkoutAttemptIdSchema,
  advertisedPriceToken: Schema.NonEmptyString,
  marketingConsent: Schema.optional(Schema.Boolean),
  /** Books as the signed-in account's own contact and Dotypos customer. */
  customer: Schema.optional(Schema.Literal("account")),
});
