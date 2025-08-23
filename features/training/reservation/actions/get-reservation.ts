"use server";

import { Effect } from "effect";
import { getReservation as getReservationService } from "@/features/dotypos";
import { DotyposServiceLive } from "@/features/dotypos/backend/service";
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
  console.log("=== Fetching reservation details ===");
  console.log("Reservation ID:", reservationId);

  try {
    const result = await Effect.runPromise(
      getReservationService(reservationId).pipe(
        Effect.provide(DotyposServiceLive)
      )
    );

    console.log("=== API Response ===");
    console.log("Full result object:", JSON.stringify(result, null, 2));

    if (!result.reservation) {
      console.log("No reservation found in result");
      return null;
    }

    console.log("=== Reservation Object ===");
    console.log("Reservation:", JSON.stringify(result.reservation, null, 2));
    console.log("Reservation status:", result.reservation.status);
    console.log("Reservation status type:", typeof result.reservation.status);

    console.log("=== Customer Object ===");
    console.log("Customer:", JSON.stringify(result.customer, null, 2));

    // Map Dotypos status to our simplified status
    // Dotypos statuses: NEW, CONFIRMED, DECLINED, CANCELLED, etc.
    let status: ReservationStatus = "submitted";
    const apiStatus = result.reservation.status?.toUpperCase();

    console.log("=== Status Mapping ===");
    console.log("Original status:", result.reservation.status);
    console.log("Uppercase status:", apiStatus);

    if (apiStatus === "CONFIRMED") {
      status = "confirmed";
    } else if (apiStatus === "DECLINED" || apiStatus === "CANCELLED") {
      status = "rejected";
    } else if (apiStatus === "NEW") {
      status = "submitted";
    }

    console.log("Mapped status:", status);

    // Parse the datetime
    const startDate = result.reservation.startDate
      ? new Date(result.reservation.startDate)
      : new Date();

    console.log("=== Date/Time Processing ===");
    console.log("Start date string:", result.reservation.startDate);
    console.log("Parsed start date:", startDate);

    const time = startDate.toLocaleTimeString("cs-CZ", {
      hour: "2-digit",
      minute: "2-digit",
    });
    console.log("Formatted time:", time);

    // Calculate duration if endDate is provided
    let duration: number | undefined;
    if (result.reservation.startDate && result.reservation.endDate) {
      const start = new Date(result.reservation.startDate);
      const end = new Date(result.reservation.endDate);
      duration = Math.round(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60)
      );
      console.log("End date string:", result.reservation.endDate);
      console.log("Calculated duration (hours):", duration);
    }

    // Construct customer name from available fields
    console.log("=== Customer Name Construction ===");
    console.log("First name:", result.customer.firstName);
    console.log("Last name:", result.customer.lastName);
    console.log("Company name:", result.customer.companyName);

    const customerName =
      [result.customer.firstName, result.customer.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      result.customer.companyName ||
      "Unknown";

    console.log("Constructed name:", customerName);

    const finalResult = {
      id: reservationId,
      status,
      name: customerName,
      email: result.customer.email || "",
      phone: result.customer.phone || "",
      date: startDate,
      time,
      duration,
      specialRequests: result.reservation.note || undefined,
    };

    console.log("=== Final Result ===");
    console.log(
      "Final result to return:",
      JSON.stringify(finalResult, null, 2)
    );

    return finalResult;
  } catch (error) {
    console.error("=== Error fetching reservation ===");
    console.error("Error details:", error);
    console.error("Error type:", typeof error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    // Return null if we can't fetch the reservation
    // The page will show a fallback UI
    return null;
  }
}
