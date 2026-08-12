import "server-only";

import { AdministrationBreadcrumbs } from "@/features/administration/admin-shell";
import {
  loadAdministrationBookingBreadcrumbLabel,
  loadAdministrationReservationBreadcrumbLabel,
} from "@/features/administration/page-data.server";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { loadDiscountAdminCustomerBreadcrumbLabel } from "@/features/discounts/admin/page-data.server";

export async function AdministrationBreadcrumb({
  segments,
}: {
  readonly segments: readonly string[];
}) {
  let entityLabel: string | undefined;

  if (segments[0] === "customers" && segments[1]) {
    entityLabel = await loadDiscountAdminCustomerBreadcrumbLabel(
      requireDotyposCustomerRouteId(segments[1])
    );
  } else if (segments[0] === "reservations" && segments[1]) {
    entityLabel =
      (await loadAdministrationReservationBreadcrumbLabel(segments[1])) ??
      undefined;
  } else if (segments[0] === "bookings" && segments[1]) {
    entityLabel = await loadAdministrationBookingBreadcrumbLabel(segments[1]);
  }

  const segmentLabels =
    entityLabel && segments[1] ? { [segments[1]]: entityLabel } : undefined;

  return (
    <AdministrationBreadcrumbs
      entityLabel={segments.length === 2 ? entityLabel : undefined}
      segmentLabels={segmentLabels}
      segments={["admin", ...segments]}
    />
  );
}
