import "server-only";

import { AdministrationBreadcrumbs } from "@/features/administration/admin-shell";
import { formatAdministrationDateTime } from "@/features/administration/components";
import {
  loadAdministrationBooking,
  loadAdministrationReservation,
} from "@/features/administration/page-data.server";
import { loadDiscountAdminCustomerBreadcrumbLabel } from "@/features/discounts/admin/page-data.server";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export async function AdministrationBreadcrumb({
  segments,
}: {
  readonly segments: readonly string[];
}) {
  let entityLabel: string | undefined;

  if (segments[0] === "customers" && segments[1]) {
    entityLabel = await loadDiscountAdminCustomerBreadcrumbLabel(
      segments[1] as DotyposCustomerId
    );
  }

  if (segments[0] === "reservations" && segments[1]) {
    const detail = await loadAdministrationReservation(segments[1]);
    entityLabel = detail.reservation.typeLabel;
  }

  if (segments[0] === "bookings" && segments[1]) {
    const detail = await loadAdministrationBooking(segments[1]);
    entityLabel =
      detail.booking.tableName ??
      formatAdministrationDateTime(detail.booking.startsAt);
  }

  const segmentLabels: Record<string, string> = {};
  if (entityLabel && segments[1]) {
    segmentLabels[segments[1]] = entityLabel;
  }

  return (
    <AdministrationBreadcrumbs
      entityLabel={segments.length === 2 ? entityLabel : undefined}
      segmentLabels={segmentLabels}
      segments={["admin", ...segments]}
    />
  );
}
