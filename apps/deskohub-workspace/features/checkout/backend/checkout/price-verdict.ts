import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";

/**
 * What a price boundary concluded about the price the customer saw: it still
 * holds, or it changed and `changedKeys` names the checkout summary items
 * that moved. `priced` is the price the checkout continues with either way.
 * Each boundary applies its own change rule, and failures that leave the
 * price unknown, such as an unanswered discount provider, stay errors.
 */
export type PriceVerdict<Priced> =
  | {
      readonly status: "affirmed";
      readonly priced: Priced;
    }
  | {
      readonly status: "pricing_changed";
      readonly priced: Priced;
      readonly changedKeys: CheckoutSummaryChangedKeys;
    };
