import { Schema } from "effect";
import {
  type CoworkReservationQuoteItem,
  coworkReservationQuoteItemSchema,
} from "@/features/checkout/reservation-quote-cowork";
import {
  type MeetingRoomReservationQuoteItem,
  meetingRoomReservationQuoteItemSchema,
} from "@/features/checkout/reservation-quote-meeting-room";

export type ReservationQuoteItem =
  | CoworkReservationQuoteItem
  | MeetingRoomReservationQuoteItem;

export const reservationQuoteItemSchema = Schema.Union([
  coworkReservationQuoteItemSchema,
  meetingRoomReservationQuoteItemSchema,
]);
