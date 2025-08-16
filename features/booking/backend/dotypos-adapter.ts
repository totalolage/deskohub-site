/**
 * Adapter to connect booking feature with Dotypos POS integration
 */

import { Effect } from "effect";
import { 
  createReservation, 
  DotyposServiceLive,
  type ReservationInput 
} from "@/features/dotypos";
import type { BookingData } from "../booking";

/**
 * Convert booking data to Dotypos reservation input
 */
export const bookingToReservationInput = (
  booking: BookingData
): ReservationInput => ({
  datetime: booking.datetime,
  duration: booking.duration,
  guestCount: booking.guestCount,
  customerName: booking.name,
  customerEmail: booking.email,
  customerPhone: booking.phone,
  tablePreference: booking.tablePreference,
  specialRequests: booking.specialRequests,
});

/**
 * Create a Dotypos reservation from booking data
 * This function provides the DotyposServiceLive layer automatically
 */
export const createBookingReservation = (booking: BookingData) =>
  createReservation(bookingToReservationInput(booking)).pipe(
    Effect.provide(DotyposServiceLive)
  );