import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function ReservationsBreadcrumb() {
  return <AdministrationBreadcrumb segments={["reservations"]} />;
}
