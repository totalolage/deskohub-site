import { notFound } from "next/navigation";
import { TableReservationForm } from "@/features/table-reservation/components/table-reservation-form";
import { m, setLocale } from "@/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["reservation.pageTitle"](),
  description: m["reservation.pageDescription"](),
});

export default async function ReservationPage({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  if (!siteConstants.featureFlags.tableReservations) {
    notFound();
  }

  return (
    <div className="container py-8 px-4 xl:max-w-5xl">
      <h1 className="text-3xl font-bold mb-6">
        {m["tableReservation.pageTitle"]()}
      </h1>
      <p className="text-gray-600 mb-8">
        {m["tableReservation.pageDescription"]()}
      </p>
      <TableReservationForm />
    </div>
  );
}
