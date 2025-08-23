import { Effect } from "effect";
import { notFound } from "next/navigation";
import { DotyposServiceLive, getReservation } from "@/features/dotypos";
import { getReservationDisplayData } from "@/features/dotypos/utils/reservation-display";
import {
  ReservationConfirmation,
  type ReservationStatus,
} from "@/features/reservation/components/reservation-confirmation";
import { tableReservationsFlag } from "@/flags";
import { m, setLocale } from "@/i18n";
import { ScrollToTop } from "@/shared/components/scroll-to-top";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale_id } from "./route";

export const generateMetadata = metadata({
  title: m["reservationConfirmation.pageTitle"](),
  description: m["reservationConfirmation.pageDescription"](),
});

export default async function ReservationConfirmationPage({
  params,
}: Readonly<RouteProps_locale_id>) {
  const { id, locale } = await params;
  setLocale(locale, { reload: false });

  console.log("=== Table Reservation Page Loading ===");
  console.log("Reservation ID from URL:", id);
  console.log("Locale:", locale);

  // Check if table reservations feature is enabled
  const tableReservationsEnabled = await tableReservationsFlag();
  if (!tableReservationsEnabled) {
    console.log("Table reservations feature is disabled");
    notFound();
  }

  // Fetch reservation from Dotypos with proper error handling
  const result = await Effect.runPromise(
    getReservation(id).pipe(
      Effect.provide(DotyposServiceLive),
      Effect.match({
        onFailure: (error) => {
          // Log error for debugging
          console.error("=== Failed to fetch reservation ===");
          console.error("Error:", error);
          // Return null to trigger 404
          return null;
        },
        onSuccess: (data) => {
          console.log("=== Successfully fetched reservation ===");
          console.log("Full result:", JSON.stringify(data, null, 2));
          return data;
        },
      })
    )
  );

  // If reservation not found or error, show 404
  if (!result) {
    console.log("No result returned, showing 404");
    notFound();
  }

  const { reservation, customer } = result;

  console.log("=== Reservation Details ===");
  console.log("Reservation:", JSON.stringify(reservation, null, 2));
  console.log("Reservation status:", reservation.status);
  console.log("Customer:", JSON.stringify(customer, null, 2));

  // Convert API response to display format
  const displayData = getReservationDisplayData(reservation);

  // Map Dotypos status to our simplified status model
  let status: ReservationStatus = "submitted";
  const apiStatus = reservation.status?.toUpperCase();

  console.log("=== Status Mapping ===");
  console.log("Original status:", reservation.status);
  console.log("Uppercase status:", apiStatus);

  if (apiStatus === "CONFIRMED") {
    status = "confirmed";
  } else if (apiStatus === "DECLINED" || apiStatus === "CANCELLED") {
    status = "rejected";
  } else if (apiStatus === "NEW") {
    status = "submitted";
  }

  console.log("Mapped status:", status);

  // Construct customer name from available fields
  const customerName =
    [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
    customer.companyName ||
    "Unknown";

  console.log("Customer name:", customerName);

  // Parse time from the datetime
  const datetime = displayData.datetime || new Date();
  const time = datetime.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Map to the ReservationDetails structure
  const reservationDetails = {
    id: displayData.id,
    name: customerName,
    email: customer.email || "",
    phone: customer.phone || "",
    date: datetime,
    time,
    duration: displayData.duration,
    guestCount: displayData.guestCount,
    specialRequests: reservation.note || undefined,
    tablePreference: displayData.needsLargerTable
      ? ("large" as const)
      : displayData.needsPrivateSpace
        ? ("private" as const)
        : ("standard" as const),
  };

  console.log("=== Final Reservation Details ===");
  console.log(
    "Details for component:",
    JSON.stringify(reservationDetails, null, 2)
  );

  return (
    <>
      <ScrollToTop />
      <ReservationConfirmation
        status={status}
        type="table"
        details={reservationDetails}
      />
    </>
  );
}
