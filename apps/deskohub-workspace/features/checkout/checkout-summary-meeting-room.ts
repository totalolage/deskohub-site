import {
  type CheckoutSummary,
  checkoutSummaryDiscountedProductItemSchema,
  checkoutSummaryDiscountSchema,
  checkoutSummaryOrderSectionSchema,
  checkoutSummaryProductItemSchema,
  checkoutSummarySchema,
  checkoutSummaryTotalSectionSchema,
} from "@/features/checkout/checkout-summary";
import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import type { MeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import type { MeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import { isSingleDayReservationInterval } from "@/features/reservation/reservation-interval";

export const getMeetingRoomCheckoutSummary = (
  reservation: MeetingRoomReservationDetails,
  quote: MeetingRoomReservationQuote
): CheckoutSummary => {
  const [item] = quote.items;
  const product: WorkspaceProductIdentity = {
    kind: item.type,
    durationMinutes: item.durationMinutes,
  };
  const key = `product:${getWorkspaceProductKey(product)}` as const;
  const meetingRoomDurationPresentation =
    item.durationMinutes === 1440 && isSingleDayReservationInterval(reservation)
      ? ("whole-day" as const)
      : ("hours" as const);
  const summaryDiscounts = quote.payment.discounts.map(({ amount, discount }) =>
    checkoutSummaryDiscountSchema.make({ amount, discount })
  );
  const productItem =
    summaryDiscounts.length > 0
      ? checkoutSummaryDiscountedProductItemSchema.make({
          key,
          product,
          meetingRoomDurationPresentation,
          amount: quote.payment.expectedPrice,
          originalAmount: quote.payment.undiscountedPrice,
          discounts: [summaryDiscounts[0]!, ...summaryDiscounts.slice(1)],
        })
      : checkoutSummaryProductItemSchema.make({
          key,
          product,
          meetingRoomDurationPresentation,
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
