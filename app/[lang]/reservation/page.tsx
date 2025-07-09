import { BookingPageContentSafeAction } from "@/components/booking/booking-page-content-safe-action";
import { m, setLocale } from "@/i18n";
import type { PropsWithLocale } from "../route";

export async function generateMetadata({ params }: Readonly<PropsWithLocale>) {
  setLocale((await params).lang);
  return {
    title: m["booking.pageTitle"](),
    description: m["booking.pageDescription"](),
  };
}

export default async function ReservationPage({ params }: PropsWithLocale) {
  setLocale((await params).lang);
  return (
    <main className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">{m["booking.pageTitle"]()}</h1>
        <p className="text-gray-600 mb-8">{m["booking.pageDescription"]()}</p>
        <BookingPageContentSafeAction />
      </div>
    </main>
  );
}
