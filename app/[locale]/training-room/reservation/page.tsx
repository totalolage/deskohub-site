import { setLocale } from "@/i18n";
import { RouteProps_locale } from "../../route";
import { ReservationForm } from "@/features/training/reservation";

export default async function TrainingRoomReservationPage({
  params,
}: RouteProps_locale) {
  setLocale((await params).locale);

  return (
    <div className="container mx-auto py-8">
      <ReservationForm />
    </div>
  );
}
