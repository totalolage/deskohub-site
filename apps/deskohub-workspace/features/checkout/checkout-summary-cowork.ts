import {
  type CheckoutSummary,
  type CheckoutSummaryOrderItem,
  checkoutSummaryDiscountedProductItemSchema,
  checkoutSummaryDiscountSchema,
  checkoutSummaryOrderSectionSchema,
  checkoutSummaryProductItemSchema,
  checkoutSummarySchema,
  checkoutSummaryTotalSectionSchema,
} from "@/features/checkout/checkout-summary";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import type { CoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { workspaceMoneyWithValue } from "@/features/checkout/workspace-money";
import {
  type CoworkReservationProductInput,
  getCoworkReservationProductMonitorOption,
} from "@/features/reservation/cowork-reservation-product";

export const getCoworkCheckoutSummary = (
  reservation: CoworkReservationProductInput,
  quote: CoworkReservationQuote
): CheckoutSummary => {
  const [productQuoteItem, coffeeQuoteItem] = quote.items;
  const product = {
    kind: productQuoteItem.type,
    tier: productQuoteItem.tier,
  } as const;
  const productKey = `product:${getWorkspaceProductKey(product)}` as const;
  const summaryDiscounts = quote.payment.discounts.map(({ amount, discount }) =>
    checkoutSummaryDiscountSchema.make({ discount, amount })
  );
  const discountedProductPrice =
    quote.payment.discounts.at(-1)?.subtotalAfter ?? productQuoteItem.amount;
  const productItem =
    summaryDiscounts.length > 0
      ? checkoutSummaryDiscountedProductItemSchema.make({
          key: productKey,
          product,
          amount: discountedProductPrice,
          originalAmount: productQuoteItem.amount,
          discounts: [summaryDiscounts[0]!, ...summaryDiscounts.slice(1)],
        })
      : checkoutSummaryProductItemSchema.make({
          key: productKey,
          product,
          amount: productQuoteItem.amount,
        });
  const orderItems: CheckoutSummaryOrderItem[] = [productItem];

  if (coffeeQuoteItem) {
    orderItems.push({
      key: "addon:coffee",
      amount: coffeeQuoteItem.amount,
    });
  }

  const monitorOption = getCoworkReservationProductMonitorOption(reservation);
  if (monitorOption) {
    orderItems.push({
      key: `monitor:${monitorOption}`,
      amount: workspaceMoneyWithValue(0, productQuoteItem.amount),
    });
  }

  const orderSection = checkoutSummaryOrderSectionSchema.make({
    key: "order",
    items: orderItems,
    total: quote.payment.expectedPrice,
  });
  const totalSection = checkoutSummaryTotalSectionSchema.make({
    key: "total",
    items: [
      {
        key: "total:final",
        amount: quote.payment.expectedPrice,
      },
    ],
    total: quote.payment.expectedPrice,
  });

  return checkoutSummarySchema.make({
    sections: [orderSection, totalSection],
    total: quote.payment.expectedPrice,
  });
};
