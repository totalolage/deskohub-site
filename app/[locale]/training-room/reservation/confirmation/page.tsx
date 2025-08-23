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

  // Since we don't store the actual reservation details,
  // we'll show a generic confirmation message
  // The email has already been sent with all the details
  const _details = {
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
    <div className="container max-w-4xl mx-auto py-12 px-4">
      <ScrollToTop />
      {/* Success Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-green-800 mb-2">
          {m["trainingReservation.confirmation.title"]()}
        </h1>
        <p className="text-gray-600 text-lg">
          {m["trainingReservation.confirmation.message"]()}
        </p>
        {reservationId && (
          <div className="mt-4">
            <span className="inline-block bg-gray-100 px-4 py-2 rounded-lg text-sm font-mono">
              {reservationId}
            </span>
          </div>
        )}
      </div>

      {/* Next Steps */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold text-blue-800 mb-3">
          {m["trainingReservation.nextSteps"]()}
        </h2>
        <p className="text-blue-700">
          {m["trainingReservation.nextStepsDescription"]()}
        </p>
      </div>

      {/* Contact Information */}
      <div className="bg-white border rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">
          {m["trainingReservation.needChanges"]()}
        </h2>
        <p className="text-gray-600 mb-4">
          {m["trainingReservation.contactForChanges"]()}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <svg
                className="w-5 h-5 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div>
              <p className="font-medium">Email</p>
              <p className="text-green-600">reservations@deskohub.cz</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <svg
                className="w-5 h-5 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                />
              </svg>
            </div>
            <div>
              <p className="font-medium">Phone</p>
              <p className="text-green-600">+420 123 456 789</p>
            </div>
          </div>
        </div>
      </div>

      {/* Back to Home Button */}
      <div className="text-center">
        <a
          href="/"
          className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium px-6 py-3 rounded-lg transition-colors"
        >
          {m["buttons.backToHome"]()}
        </a>
      </div>
    </div>
  );
}
