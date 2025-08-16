/**
 * Adapter to connect booking feature with Dotypos POS integration
 */
import { createReservation, type ReservationInput } from "@/features/dotypos";
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
 */
export const createBookingReservation = (booking: BookingData) =>
  createReservation(bookingToReservationInput(booking));
