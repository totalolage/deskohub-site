import { notFound } from "next/navigation";
import { type Locale, setLocale } from "@/features/i18n";
import { m } from "@/features/i18n/paraglide/messages";
import { ReservationConfirmation } from "@/features/reservation/components/reservation-confirmation";
import { ScrollToTop } from "@/shared/components/scroll-to-top";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";
import { getTrainingRoomConfirmationDetails } from "./confirmation-details";

// Route type definitions
export interface RouteParams_locale {
  locale: Locale;
}

export interface RouteProps_locale {
  params: Promise<RouteParams_locale>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const generateMetadata = metadata({
  title: m["trainingReservation.success.title"](),
  description: m["trainingReservation.success.description"](),
});

// This page receives query parameters from the submission
// and displays them in the confirmation

export default async function TrainingRoomConfirmationPage({
  params,
  searchParams,
}: Readonly<RouteProps_locale>) {
  // Return 404 if training room reservations are disabled
  if (!siteConstants.featureFlags.boardroomReservations) {
    notFound();
  }

  const { locale } = await params;
  setLocale(locale, { reload: false });

  const confirmationDetails = getTrainingRoomConfirmationDetails(
    await searchParams
  );

  return (
    <>
      <ScrollToTop />
      <ReservationConfirmation
        status="submitted"
        type="training-room"
        details={confirmationDetails}
        customMessage={
          <div className="space-y-2">
            <p>{m["trainingReservation.success.title"]()}</p>
            <p className="text-sm text-gray-500">
              {m["trainingReservation.success.description"]()}
            </p>
          </div>
        }
      />
    </>
  );
}
