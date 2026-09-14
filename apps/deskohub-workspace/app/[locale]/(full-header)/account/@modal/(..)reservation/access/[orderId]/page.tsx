import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { ReservationAccessRoute } from "@/features/reservation/components/reservation-access-route";
import { ReservationDetailsModal } from "@/features/reservation/components/reservation-details-modal";

type ReservationAccessModalPageProps = {
  readonly params: Promise<{ readonly orderId: string }>;
};

export default function ReservationAccessModalPage({
  params,
}: ReservationAccessModalPageProps) {
  return runWithRequestLocale((locale) => (
    <ReservationDetailsModal locale={locale}>
      <ReservationAccessRoute params={params} presentation="modal" />
    </ReservationDetailsModal>
  ));
}
