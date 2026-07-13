import type { CoworkReservationQuoteItem } from "@/features/checkout/reservation-quote-cowork";
import type { MeetingRoomReservationQuoteItem } from "@/features/checkout/reservation-quote-meeting-room";

export type ReservationQuoteItem =
  | CoworkReservationQuoteItem
  | MeetingRoomReservationQuoteItem;
