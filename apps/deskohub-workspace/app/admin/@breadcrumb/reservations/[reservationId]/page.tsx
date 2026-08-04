import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default async function ReservationBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly reservationId: string }>;
}) {
  const { reservationId } = await params;
  return (
    <AdministrationBreadcrumb segments={["reservations", reservationId]} />
  );
}
