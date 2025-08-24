import { ReservationConfirmation } from "@/features/reservation/components/reservation-confirmation";
import { type Locale, setLocale } from "@/i18n";
import { m } from "@/i18n/paraglide/messages";
import { ScrollToTop } from "@/shared/components/scroll-to-top";
import { metadata } from "@/shared/utils/metadata";

// Route type definitions
export interface RouteParams_locale {
  locale: Locale;
}

export interface RouteProps_locale {
  params: Promise<RouteParams_locale>;
}

export const generateMetadata = metadata({
  title: m["trainingReservation.confirmation.title"](),
  description: m["trainingReservation.confirmation.message"](),
});

// This page is fully static - training room reservations
// don't create real Dotypos reservations, just send emails
// The confirmation page always shows a generic success message

export default async function TrainingRoomConfirmationPage({
  params,
  searchParams,
}: Readonly<
  RouteProps_locale & {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  }
>) {
  const { locale } = await params;
  const search = await searchParams;
  setLocale(locale, { reload: false });

  // Get the reservation ID from the query params
  // Note: Training room reservations generate temporary IDs (TR-xxx)
  // and don't create real Dotypos reservations
  const reservationId = (search.id as string) || "";

  // Training room reservations always show a static confirmation
  // They don't fetch from Dotypos since they only send emails
  const confirmationDetails = {
    id: reservationId,
    name: "",
    email: "",
    phone: "",
    date: new Date(),
    time: "",
    duration: undefined,
    specialRequests: undefined,
  };

  return (
    <>
      <ScrollToTop />
      <ReservationConfirmation
        status="submitted"
        type="training-room"
        details={confirmationDetails}
        customMessage={
          <div className="space-y-2">
            <p>{m["trainingReservation.confirmation.message"]()}</p>
            {!reservationId && (
              <p className="text-sm text-gray-500">
                {m["trainingReservation.confirmation.noIdMessage"]?.() ||
                  "No reservation ID provided. Please check your email for details."}
              </p>
            )}
          </div>
        }
      />
    </>
  );
}
