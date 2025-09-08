import { Effect } from "effect";
import { notFound } from "next/navigation";
import { DotyposServiceLive, getReservation } from "@/features/dotypos";
import { parseNoteWithMetadata } from "@/features/dotypos/utils/note-metadata";
import { getReservationDisplayData } from "@/features/dotypos/utils/reservation-display";
import { getLocale, m, setLocale } from "@/features/i18n";
import {
  ReservationConfirmation,
  type ReservationStatus,
} from "@/features/reservation/components/reservation-confirmation";
import { WebhookTestPanel } from "@/features/reservation/components/webhook-test-panel";
import { ScrollToTop } from "@/shared/components/scroll-to-top";
import { siteConstants } from "@/shared/utils/constants";
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
  if (!siteConstants.featureFlags.tableReservations) {
    notFound();
  }

  // Fetch reservation from cache or Dotypos
  const result = await Effect.runPromise(
    getReservation(id).pipe(
      Effect.provide(DotyposServiceLive),
      Effect.match({
        onFailure: (_error) => {
          // Return null to trigger 404
          return null;
        },
        onSuccess: (data) => {
          return data;
        },
      })
    )
  );

  // If reservation not found or error, show 404
  if (!result) {
    notFound();
  }

  const { reservation, customer } = result;

  // Convert API response to display format
  const displayData = getReservationDisplayData(reservation);

  // Map Dotypos status to our simplified status model
  let status: ReservationStatus = "submitted";
  const apiStatus = reservation.status?.toUpperCase();

  // Map API status to UI status

  if (apiStatus === "CONFIRMED") {
    status = "confirmed";
  } else if (apiStatus === "DECLINED" || apiStatus === "CANCELLED") {
    status = "rejected";
  } else if (apiStatus === "NEW") {
    status = "submitted";
  }

  // Status mapped successfully

  // Construct customer name from available fields
  const customerName =
    [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
    customer.companyName ||
    "Unknown";

  // Parse the note to extract only special requests
  const parsedNote = reservation.note
    ? parseNoteWithMetadata(reservation.note)
    : null;

  // Parse time from the datetime
  const datetime = displayData.datetime || new Date();
  const time = datetime.toLocaleTimeString(
    parsedNote?.metadata.locale ?? getLocale(),
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  );

  // Map to the ReservationDetails structure
  const reservationDetails = {
    id: displayData.id,
    name: customerName,
    email: customer.email ?? undefined,
    phone: customer.phone ?? undefined,
    date: datetime,
    time,
    duration: displayData.duration,
    guestCount: displayData.guestCount,
    specialRequests: parsedNote?.specialRequests,
    tablePreference: displayData.needsLargerTable
      ? ("large" as const)
      : displayData.needsPrivateSpace
        ? ("private" as const)
        : ("standard" as const),
  };

  // Reservation details prepared for display

  return (
    <>
      <ScrollToTop />
      <ReservationConfirmation
        status={status}
        type="table"
        details={reservationDetails}
      />
      <div className="container mx-auto px-4 pb-8">
        <WebhookTestPanel
          reservationId={reservation.id}
          customerId={customer.id}
          currentStatus={reservation.status}
        />
      </div>
    </>
  );
}
