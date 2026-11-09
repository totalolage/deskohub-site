import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function BookingsBreadcrumb() {
  return <AdministrationBreadcrumb segments={["bookings"]} />;
}
