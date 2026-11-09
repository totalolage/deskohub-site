import { Match, Schema } from "effect";
import { type Locale, m } from "@/features/i18n";

const discountCodeRejectionSchema = Schema.Literals([
  "unavailable",
  "referral-already-attributed",
  "referral-ineligible",
  "automated-request",
]);

/** Why the Pay page's code box refused a submitted code. */
export type DiscountCodeRejection = typeof discountCodeRejectionSchema.Type;

/** Reads the Pay-page search value; anything unknown shows no error. */
export const parseDiscountCodeRejection = (
  value: string | undefined
): DiscountCodeRejection | undefined =>
  Schema.is(discountCodeRejectionSchema)(value) ? value : undefined;

export const getDiscountCodeRejectionMessage = (
  rejection: DiscountCodeRejection,
  locale: Locale
) =>
  Match.value(rejection).pipe(
    Match.when("unavailable", () =>
      m.checkoutDiscountCodeUnavailable({}, { locale })
    ),
    Match.when("referral-already-attributed", () =>
      m.checkoutReferralCodeAlreadyAttributed({}, { locale })
    ),
    Match.when("referral-ineligible", () =>
      m.checkoutReferralCodeIneligible({}, { locale })
    ),
    Match.when("automated-request", () =>
      m.automatedRequestRejected({}, { locale })
    ),
    Match.exhaustive
  );
