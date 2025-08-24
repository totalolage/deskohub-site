"use server";

import { Effect } from "effect";
import { getReservation as getReservationService } from "@/features/dotypos";
import { DotyposServiceLive } from "@/features/dotypos/backend/service";
import { parseNoteWithMetadata } from "@/features/dotypos/utils/note-metadata";
import type { ReservationStatus } from "@/features/reservation/components/reservation-confirmation";

export interface ReservationWithStatus {
  id: string;
  status: ReservationStatus;
  name: string;
  email: string;
  phone: string;
  date: Date;
  time: string;
  duration?: number;
  specialRequests?: string;
}

/**
 * Fetch reservation details from Dotypos API
 * Maps the API status to our simplified status model
 */
export async function getReservationDetails(
  reservationId: string
): Promise<ReservationWithStatus | null> {
  // Note: This function is called from a cached context in the page component
  // The caching is handled at the page level, not here
  try {
    const result = await Effect.runPromise(
      getReservationService(reservationId).pipe(
        Effect.provide(DotyposServiceLive)
      )
    );

    if (!result.reservation) {
      return null;
    }

    // Map Dotypos status to our simplified status
    // Dotypos statuses: NEW, CONFIRMED, DECLINED, CANCELLED, etc.
    let status: ReservationStatus = "submitted";
    const apiStatus = result.reservation.status?.toUpperCase();

    if (apiStatus === "CONFIRMED") {
      status = "confirmed";
    } else if (apiStatus === "DECLINED" || apiStatus === "CANCELLED") {
      status = "rejected";
    } else if (apiStatus === "NEW") {
      status = "submitted";
    }

    // Parse the datetime
    const startDate = result.reservation.startDate
      ? new Date(result.reservation.startDate)
      : new Date();

    const time = startDate.toLocaleTimeString("cs-CZ", {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Calculate duration if endDate is provided
    let duration: number | undefined;
    if (result.reservation.startDate && result.reservation.endDate) {
      const start = new Date(result.reservation.startDate);
      const end = new Date(result.reservation.endDate);
      duration = Math.round(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60)
      );
    }

    // Construct customer name from available fields
    const customerName =
      [result.customer.firstName, result.customer.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      result.customer.companyName ||
      "Unknown";

    // Parse the note to extract only special requests
    const parsedNote = result.reservation.note
      ? parseNoteWithMetadata(result.reservation.note)
      : null;
    const specialRequests = parsedNote?.specialRequests || undefined;

    const finalResult = {
      id: reservationId,
      status,
      name: customerName,
      email: result.customer.email || "",
      phone: result.customer.phone || "",
      date: startDate,
      time,
      duration,
      specialRequests,
    };

    return finalResult;
  } catch (error) {
    // Return null if we can't fetch the reservation
    // The page will show a fallback UI
    return null;
  }
}
