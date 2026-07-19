import { Effect } from "effect";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  isWorkspaceMeetingRoomDuration,
  type WorkspaceMeetingRoomDurationMinutes,
} from "@/features/checkout/product-catalog";
import { ReservationQuoteError } from "@/features/checkout/reservation-quote-error";
import {
  type WorkspaceMoney,
  withWorkspaceMoneyCurrency,
} from "@/features/checkout/workspace-money";
import { getDurationMinutes } from "@/features/reservation/reservation-interval-normalization";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

type MeetingRoomReservation = Extract<
  ReservationOrderData,
  { kind: "meeting-room" }
>;

export type MeetingRoomReservationQuoteItem = {
  readonly type: "meeting-room";
  readonly durationMinutes: WorkspaceMeetingRoomDurationMinutes;
  readonly amount: WorkspaceMoney;
};

export type CanonicalMeetingRoomReservation = {
  readonly kind: "meeting-room";
  readonly startsAt: MeetingRoomReservation["startsAt"];
  readonly endsAt: MeetingRoomReservation["endsAt"];
};

export const getMeetingRoomReservationQuote = (
  reservation: MeetingRoomReservation,
  currencyOverride?: string
): Effect.Effect<
  {
    readonly items: readonly MeetingRoomReservationQuoteItem[];
    readonly payment: {
      readonly expectedPrice: MeetingRoomReservationQuoteItem["amount"];
      readonly undiscountedPrice: MeetingRoomReservationQuoteItem["amount"];
      readonly discounts: readonly [];
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

  const amount = withWorkspaceMoneyCurrency(
    getWorkspaceMeetingRoomPriceForDuration(durationMinutes),
    currencyOverride
  );

  return Effect.succeed({
    items: [
      {
        type: "meeting-room",
        durationMinutes,
        amount,
      },
    ],
    payment: {
      expectedPrice: amount,
      undiscountedPrice: amount,
      discounts: [],
    },
  });
};

export const getCanonicalMeetingRoomReservation = (
  reservation: MeetingRoomReservation
): CanonicalMeetingRoomReservation => ({
  kind: "meeting-room" as const,
  startsAt: reservation.startsAt,
  endsAt: reservation.endsAt,
});
