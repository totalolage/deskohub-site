import { notFound } from "next/navigation";
import { type Locale, setLocale } from "@/features/i18n";
import { m } from "@/features/i18n/paraglide/messages";
import { ReservationConfirmation } from "@/features/reservation/components/reservation-confirmation";
import { ScrollToTop } from "@/shared/components/scroll-to-top";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";

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

  // Extract query parameters
  const searchParamsData = await searchParams;

  // Build display name from company or firstName + lastName
  const company = searchParamsData.company as string | undefined;
  const firstName = searchParamsData.firstName as string | undefined;
  const lastName = searchParamsData.lastName as string | undefined;
  const role = searchParamsData.role as string | undefined;

  let displayName = "";
  if (company) {
    displayName = company;
    if (firstName && lastName && role) {
      displayName = `${company} - ${firstName} ${lastName} (${role})`;
    }
  } else if (firstName && lastName) {
    displayName = `${firstName} ${lastName}`;
  }

  // Parse date if provided
  const dateString = searchParamsData.date as string | undefined;
  const date = dateString ? new Date(dateString) : new Date();

  // Build confirmation details from query parameters
  const confirmationDetails = {
    id: "", // No ID for training room reservations
    name: displayName,
    email: (searchParamsData.email as string) || "",
    phone: (searchParamsData.phone as string) || "",
    date: date,
    time: (searchParamsData.time as string) || "",
    duration: searchParamsData.duration
      ? parseInt(searchParamsData.duration as string, 10)
      : undefined,
    specialRequests: searchParamsData.specialRequirements as string | undefined,
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
