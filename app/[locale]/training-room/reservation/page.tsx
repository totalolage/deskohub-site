import { m, setLocale } from "@/i18n";
import { RouteProps_locale } from "../../route";
import { ReservationForm } from "@/features/training/reservation";
import { metadata } from "@/shared/utils/metadata";

export const generateMetadata = metadata({
  title: m["trainingReservation.pageTitle"](),
  description: m["trainingReservation.pageDescription"](),
})

export default async function TrainingRoomReservationPage({
  params,
}: RouteProps_locale) {
  setLocale((await params).locale, { reload: false });

  return (
    <div className="container mx-auto py-8">
      <ReservationForm />
    </div>
  );
}
