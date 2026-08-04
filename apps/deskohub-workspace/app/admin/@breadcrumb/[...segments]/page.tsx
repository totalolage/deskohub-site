import { AdministrationBreadcrumbs } from "@/features/administration/admin-shell";
import {
  administrationFixturesEnabled,
  loadFixtureCustomerProfile,
} from "@/features/administration/fixtures";
import { loadAdministrationReservation } from "@/features/administration/page-data.server";
import { loadDiscountAdminCustomerBreadcrumbLabel } from "@/features/discounts/admin/page-data.server";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export default async function AdministrationBreadcrumbSlot({
  params,
}: {
  readonly params: Promise<{ readonly segments: readonly string[] }>;
}) {
  const { segments } = await params;
  let entityLabel: string | undefined;

  if (segments[0] === "customers" && segments[1]) {
    entityLabel = administrationFixturesEnabled()
      ? loadFixtureCustomerProfile(segments[1])?.customer.displayName
      : await loadDiscountAdminCustomerBreadcrumbLabel(
          segments[1] as DotyposCustomerId
        );
  }

  if (segments[0] === "reservations" && segments[1]) {
    const detail = await loadAdministrationReservation(segments[1]);
    entityLabel = detail.reservation.typeLabel;
  }

  return (
    <AdministrationBreadcrumbs
      entityLabel={entityLabel}
      segments={["admin", ...segments]}
    />
  );
}
