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
}: Readonly<RouteProps_locale>) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  // Training room reservations always show a static confirmation
  // They don't create Dotypos reservations or have IDs
  const confirmationDetails = {
    id: "", // No ID for training room reservations
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
            <p className="text-sm text-gray-500">
              {m["trainingReservation.confirmation.emailMessage"]?.() ||
                "We have sent you a confirmation email with all the details."}
            </p>
          </div>
        }
      />
    </>
  );
}
