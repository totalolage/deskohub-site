import { Effect, Schema } from "effect";
import {
  type CheckoutSummary,
  checkoutSummaryDiscountedProductItemSchema,
  checkoutSummaryDiscountSchema,
  checkoutSummaryOrderSectionSchema,
  checkoutSummaryProductItemSchema,
  checkoutSummarySchema,
  checkoutSummaryTotalSectionSchema,
} from "@/features/checkout/checkout-quote";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  isWorkspaceMeetingRoomDuration,
  workspaceMeetingRoomDurationOptions,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import { ReservationQuoteError } from "@/features/checkout/reservation-quote-error";
import { makeReservationQuoteSchema } from "@/features/checkout/reservation-quote-schema";
import { workspaceMoneyCodec } from "@/features/checkout/workspace-money";
import type { DiscountQuote } from "@/features/discounts/contracts";
import type { MeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import { getDurationMinutes } from "@/features/reservation/reservation-interval-normalization";

export const meetingRoomReservationQuoteItemSchema = Schema.Struct({
  type: Schema.Literal("meeting-room"),
  durationMinutes: Schema.Literals(workspaceMeetingRoomDurationOptions),
  amount: workspaceMoneyCodec,
});

export type MeetingRoomReservationQuoteItem =
  typeof meetingRoomReservationQuoteItemSchema.Type;

export const meetingRoomReservationQuoteSchema = makeReservationQuoteSchema(
  Schema.Tuple([meetingRoomReservationQuoteItemSchema])
);

export type MeetingRoomReservationQuote =
  typeof meetingRoomReservationQuoteSchema.Type;

export const getMeetingRoomCheckoutSummary = (
  quote: MeetingRoomReservationQuote
): CheckoutSummary => {
  const [item] = quote.items;
  const product: WorkspaceProductIdentity = {
    kind: item.type,
    durationMinutes: item.durationMinutes,
  };
  const key = `product:${getWorkspaceProductKey(product)}` as const;
  const summaryDiscounts = quote.payment.discounts.map(({ amount, discount }) =>
    checkoutSummaryDiscountSchema.make({ amount, discount })
  );
  const productItem =
    summaryDiscounts.length > 0
      ? checkoutSummaryDiscountedProductItemSchema.make({
          key,
          product,
          amount: quote.payment.expectedPrice,
          originalAmount: quote.payment.undiscountedPrice,
          discounts: [summaryDiscounts[0]!, ...summaryDiscounts.slice(1)],
        })
      : checkoutSummaryProductItemSchema.make({
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

export type CanonicalMeetingRoomReservation = {
  readonly kind: "meeting-room";
  readonly startsAt: MeetingRoomReservationDetails["startsAt"];
  readonly endsAt: MeetingRoomReservationDetails["endsAt"];
};

export const getMeetingRoomReservationQuote = (
  reservation: MeetingRoomReservationDetails,
  options: {
    readonly discountQuote?: DiscountQuote;
  } = {}
): Effect.Effect<
  {
    readonly items: readonly [MeetingRoomReservationQuoteItem];
    readonly payment: {
      readonly expectedPrice: MeetingRoomReservationQuoteItem["amount"];
      readonly undiscountedPrice: MeetingRoomReservationQuoteItem["amount"];
      readonly discounts: DiscountQuote["discounts"];
    };
  },
  ReservationQuoteError
> => {
  const durationMinutes = getDurationMinutes(reservation);

  if (!isWorkspaceMeetingRoomDuration(durationMinutes)) {
    return Effect.fail(
      new ReservationQuoteError({
        message: "Meeting room checkout pricing requires an approved duration.",
      })
    );
  }

  const amount = getWorkspaceMeetingRoomPriceForDuration(durationMinutes);
  const discounts = options.discountQuote?.discounts ?? [];
  const expectedPrice = options.discountQuote?.discountedSubtotal ?? amount;

  return Effect.succeed({
    items: [
      {
        type: "meeting-room",
        durationMinutes,
        amount,
      },
    ],
    payment: {
      expectedPrice,
      undiscountedPrice: amount,
      discounts,
    },
  });
};

export const getCanonicalMeetingRoomReservation = (
  reservation: MeetingRoomReservationDetails
): CanonicalMeetingRoomReservation => ({
  kind: "meeting-room" as const,
  startsAt: reservation.startsAt,
  endsAt: reservation.endsAt,
});
