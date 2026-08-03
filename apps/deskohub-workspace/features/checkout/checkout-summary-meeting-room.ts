import {
  type CheckoutSummary,
  checkoutSummaryDiscountSchema,
  checkoutSummaryOrderSectionSchema,
  checkoutSummarySchema,
  checkoutSummaryTotalSectionSchema,
} from "@/features/checkout/checkout-summary";
import {
  meetingRoomCheckoutSummaryDiscountedProductItemSchema,
  meetingRoomCheckoutSummaryProductItemSchema,
} from "@/features/checkout/checkout-summary-meeting-room-item";
import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import type { MeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";

export const getMeetingRoomCheckoutSummary = (
  quote: MeetingRoomReservationQuote
): CheckoutSummary => {
  const [item] = quote.items;
  const product: WorkspaceProductIdentity = {
    kind: item.type,
    duration: item.duration,
  };
  const key = `product:${getWorkspaceProductKey(product)}` as const;
  const summaryDiscounts = quote.payment.discounts.map(({ amount, discount }) =>
    checkoutSummaryDiscountSchema.make({ amount, discount })
  );
  const productItem =
    summaryDiscounts.length > 0
      ? meetingRoomCheckoutSummaryDiscountedProductItemSchema.make({
          key,
          product,
          amount: quote.payment.expectedPrice,
          originalAmount: quote.payment.undiscountedPrice,
          discounts: [summaryDiscounts[0]!, ...summaryDiscounts.slice(1)],
        })
      : meetingRoomCheckoutSummaryProductItemSchema.make({
          key,
          product,
          amount: quote.payment.undiscountedPrice,
        });
  const orderSection = checkoutSummaryOrderSectionSchema.make({
    key: "order",
    items: [productItem],
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
