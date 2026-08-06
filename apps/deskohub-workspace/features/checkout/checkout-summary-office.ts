import {
  type CheckoutSummary,
  checkoutSummaryDiscountSchema,
  checkoutSummaryOrderSectionSchema,
  checkoutSummarySchema,
  checkoutSummaryTotalSectionSchema,
} from "@/features/checkout/checkout-summary";
import {
  officeCheckoutSummaryDiscountedProductItemSchema,
  officeCheckoutSummaryProductItemSchema,
} from "@/features/checkout/checkout-summary-office-item";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import type { OfficeReservationQuote } from "@/features/checkout/reservation-quote-office";

export const getOfficeCheckoutSummary = (
  quote: OfficeReservationQuote
): CheckoutSummary => {
  const [item] = quote.items;
  const product = { kind: "office" as const };
  const key = `product:${getWorkspaceProductKey(product)}` as const;
  const summaryDiscounts = quote.payment.discounts.map(({ amount, discount }) =>
    checkoutSummaryDiscountSchema.make({ amount, discount })
  );
  const shared = {
    key,
    product,
    dayCount: item.dayCount,
    additionalGuests: item.additionalGuests,
    accessAmount: item.accessAmount,
    seatAmount: item.seatAmount,
  };
  const productItem =
    summaryDiscounts.length > 0
      ? officeCheckoutSummaryDiscountedProductItemSchema.make({
          ...shared,
          amount: quote.payment.expectedPrice,
          originalAmount: quote.payment.undiscountedPrice,
          discounts: [summaryDiscounts[0]!, ...summaryDiscounts.slice(1)],
        })
      : officeCheckoutSummaryProductItemSchema.make({
          ...shared,
          amount: quote.payment.undiscountedPrice,
        });
  const orderSection = checkoutSummaryOrderSectionSchema.make({
    key: "order",
    items: [productItem],
    total: quote.payment.expectedPrice,
  });
  const totalSection = checkoutSummaryTotalSectionSchema.make({
    key: "total",
    items: [{ key: "total:final", amount: quote.payment.expectedPrice }],
    total: quote.payment.expectedPrice,
  });

  return checkoutSummarySchema.make({
    sections: [orderSection, totalSection],
    total: quote.payment.expectedPrice,
  });
};
