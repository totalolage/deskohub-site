import { notFound } from "next/navigation";
import { BookingForm } from "@/features/booking/components/booking-form";
import { m, setLocale } from "@/i18n";
import { tableReservationsFlag } from "@/shared/lib/feature-flags";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["reservation.pageTitle"](),
  description: m["reservation.pageDescription"](),
});

export default async function ReservationPage({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  // Check if table reservations feature is enabled
  const tableReservationsEnabled = await tableReservationsFlag();
  if (!tableReservationsEnabled) {
    notFound();
  }

  return (
    <div className="container py-8 px-4 xl:max-w-5xl">
      <h1 className="text-3xl font-bold mb-6">{m["booking.pageTitle"]()}</h1>
      <p className="text-gray-600 mb-8">{m["booking.pageDescription"]()}</p>
      <BookingForm />
    </div>
  );
}
