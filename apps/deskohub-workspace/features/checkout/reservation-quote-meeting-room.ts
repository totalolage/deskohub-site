import { Effect, Schema } from "effect";
import {
  getWorkspaceMeetingRoomDurationMinutes,
  getWorkspaceMeetingRoomPriceForDuration,
  workspaceMeetingRoomDurationOptions,
} from "@/features/checkout/product-catalog";
import type { ReservationQuoteError } from "@/features/checkout/reservation-quote-error";
import { makeReservationQuoteSchema } from "@/features/checkout/reservation-quote-schema";
import { workspaceMoneyCodec } from "@/features/checkout/workspace-money";
import type { DiscountQuote } from "@/features/discounts/contracts";
import type { MeetingRoomReservationPricingInput } from "@/features/reservation/meeting-room-reservation";

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

export type CanonicalMeetingRoomReservation = {
  readonly kind: "meeting-room";
  readonly duration: MeetingRoomReservationPricingInput["duration"];
  readonly reservationDate: MeetingRoomReservationPricingInput["reservationDate"];
};

export const getMeetingRoomReservationQuote = (
  reservation: MeetingRoomReservationPricingInput,
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
  const durationMinutes = getWorkspaceMeetingRoomDurationMinutes(
    reservation.duration
  );
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
  reservation: MeetingRoomReservationPricingInput
): CanonicalMeetingRoomReservation => ({
  kind: "meeting-room" as const,
  duration: reservation.duration,
  reservationDate: reservation.reservationDate,
});
