import type { AdministrationSearchParams } from "@/features/administration/page-data.server";
import { AdministrationReservationList } from "@/features/administration/reservation-list";

export default function ReservationsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  return <AdministrationReservationList searchParams={searchParams} />;
}
