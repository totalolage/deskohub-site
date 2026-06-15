import { notFound } from "next/navigation";
import { m, setLocale } from "@/features/i18n";
import { ReservationForm } from "@/features/training/reservation";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../../route";

export const generateMetadata = metadata({
  title: m["trainingReservation.pageTitle"](),
  description: m["trainingReservation.pageDescription"](),
});

export default async function TrainingRoomReservationPage({
  params,
}: RouteProps_locale) {
  // Return 404 if training room reservations are disabled
  if (!siteConstants.featureFlags.boardroomReservations) {
    notFound();
  }

  setLocale((await params).locale, { reload: false });

  return (
    <div className="container mx-auto py-8">
      <ReservationForm />
    </div>
  );
}
