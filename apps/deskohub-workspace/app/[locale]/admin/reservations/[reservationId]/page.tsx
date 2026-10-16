import { AdministrationReservationDetail } from "@/features/administration/reservation-detail";

export default function ReservationAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly reservationId: string }>;
}) {
  return <AdministrationReservationDetail params={params} />;
}
