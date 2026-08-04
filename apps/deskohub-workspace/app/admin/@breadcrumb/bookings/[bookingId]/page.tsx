import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default async function BookingBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly bookingId: string }>;
}) {
  const { bookingId } = await params;
  return <AdministrationBreadcrumb segments={["bookings", bookingId]} />;
}
