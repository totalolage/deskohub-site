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
  /** Labels a grant a browser assistant submitted through the site's tools. */
  marketingConsentSource: Schema.optional(Schema.Literal("site_tool")),
  /** Books as the signed-in account's own contact and Dotypos customer. */
  customer: Schema.optional(Schema.Literal("account")),
});

/** A consent source only labels a grant, so it needs `marketingConsent: true`. */
export const marketingConsentSourceRequiresConsent = Schema.makeFilter<{
  readonly marketingConsent?: boolean | undefined;
  readonly marketingConsentSource?: "site_tool" | undefined;
}>(
  ({ marketingConsent, marketingConsentSource }) =>
    marketingConsentSource === undefined ||
    marketingConsent === true || {
      path: ["marketingConsentSource"],
      issue: "A marketing consent source requires marketingConsent: true",
    }
);
