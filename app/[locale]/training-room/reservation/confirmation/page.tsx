import { unstable_cache } from "next/cache";
import { ReservationConfirmation } from "@/features/reservation/components/reservation-confirmation";
import { getReservationDetails } from "@/features/training/reservation/actions/get-reservation";
import { type Locale, setLocale } from "@/i18n";
import { m } from "@/i18n/paraglide/messages";
import { getReservationPageCacheTags } from "@/shared/backend/utils/cache-tags";
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

// Configure rendering with ISR
// Page will be cached and revalidated via cache tags
// We don't use 'force-static' to allow dynamic params
export const revalidate = 3600; // Revalidate after 1 hour

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
  const reservationId = (search.id as string) || "";

  // Create cached version of the reservation fetch
  const getCachedReservationDetails = unstable_cache(
    async (id: string) => {
      if (!id) return null;
      return await getReservationDetails(id);
    },
    ['training-reservation-detail'],
    {
      revalidate: 3600, // Cache for 1 hour
      tags: reservationId ? getReservationPageCacheTags(reservationId) : [],
    }
  );

  // Try to fetch reservation details from cache or API
  const reservationDetails = reservationId
    ? await getCachedReservationDetails(reservationId)
    : null;

  // If we have reservation details, use the ReservationConfirmation component
  if (reservationDetails) {
    return (
      <>
        <ScrollToTop />
        <ReservationConfirmation
          status={reservationDetails.status}
          type="training-room"
          details={{
            id: reservationDetails.id,
            name: reservationDetails.name,
            email: reservationDetails.email,
            phone: reservationDetails.phone,
            date: reservationDetails.date,
            time: reservationDetails.time,
            duration: reservationDetails.duration,
            specialRequests: reservationDetails.specialRequests,
          }}
        />
      </>
    );
  }

  // Fallback: Show a generic submitted status if we can't fetch the reservation
  // This handles cases where the API is unavailable or the reservation ID is invalid
  const fallbackDetails = {
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
        details={fallbackDetails}
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
