import { Schema } from "effect";
import {
  type CoworkReservationQuoteItem,
  coworkReservationQuoteItemSchema,
} from "@/features/checkout/reservation-quote-cowork";
import {
  type MeetingRoomReservationQuoteItem,
  meetingRoomReservationQuoteItemSchema,
} from "@/features/checkout/reservation-quote-meeting-room";
import {
  type OfficeReservationQuoteItem,
  officeReservationQuoteItemSchema,
} from "@/features/checkout/reservation-quote-office";

export type ReservationQuoteItem =
  | CoworkReservationQuoteItem
  | MeetingRoomReservationQuoteItem
  | OfficeReservationQuoteItem;

export const reservationQuoteItemSchema = Schema.Union([
  coworkReservationQuoteItemSchema,
  meetingRoomReservationQuoteItemSchema,
  officeReservationQuoteItemSchema,
]);
