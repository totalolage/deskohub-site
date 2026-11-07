import { Schema } from "effect";

/**
 * A referral code in the shared promotion namespace. It has its own entry
 * point so a browser bundle can validate codes without the HTTP API
 * definitions the package root builds when it loads.
 */
export const ReferralCode = Schema.String.check(
  Schema.isPattern(/^[A-Z0-9][A-Z0-9_-]{2,63}$/)
)
  .pipe(Schema.brand("ReferralCode"))
  .annotate({
    identifier: "ReferralCode",
    description:
      "Uppercase ASCII referral code in the shared promotion namespace.",
  });
export type ReferralCode = typeof ReferralCode.Type;
