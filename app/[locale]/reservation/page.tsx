import { BookingForm } from "@/features/booking/components/booking-form";
import { m, setLocale } from "@/i18n";
import type { RouteProps_locale } from "../route";

export async function generateMetadata({
  params,
}: Readonly<RouteProps_locale>) {
  setLocale((await params).locale);
  return {
    title: m["booking.pageTitle"](),
    description: m["booking.pageDescription"](),
  };
}

export default async function ReservationPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);
  return (
    <main className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">{m["booking.pageTitle"]()}</h1>
        <p className="text-gray-600 mb-8">{m["booking.pageDescription"]()}</p>
        <BookingForm />
      </div>
    </main>
  );
}
