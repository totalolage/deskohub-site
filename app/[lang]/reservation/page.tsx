import { m, setLocale } from "@/i18n";
import { BookingPageContent } from "@/components/booking/booking-page-content";
import type { PropsWithParams } from "../route";

export async function generateMetadata({ params }: Readonly<PropsWithParams>) {
  const { lang } = await params;
  setLocale(lang, { reload: false });

  return {
    title: m["booking.pageTitle"](),
    description: m["booking.pageDescription"](),
  };
}

export default async function ReservationPage({ params }: PropsWithParams) {
  const { lang } = await params;
  setLocale(lang, { reload: false });

  return (
    <main className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">{m["booking.pageTitle"]()}</h1>
        <p className="text-gray-600 mb-8">{m["booking.pageDescription"]()}</p>
        <BookingPageContent />
      </div>
    </main>
  );
}