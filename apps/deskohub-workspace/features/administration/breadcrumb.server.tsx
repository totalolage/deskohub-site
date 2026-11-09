import "server-only";

import { loadInvoiceAdministrationBreadcrumbLabel } from "@/features/accounting/admin/invoice-breadcrumb.server";
import { AdministrationBreadcrumbs } from "@/features/administration/admin-shell";
import type { AdministrationRecordArea } from "@/features/administration/administration-areas";
import {
  type AdministrationRecordLabelLoader,
  loadAdministrationRecordLabel,
} from "@/features/administration/administration-record-label";
import {
  loadAdministrationBookingBreadcrumbLabel,
  loadAdministrationReservationBreadcrumbLabel,
} from "@/features/administration/page-data.server";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { loadDiscountAdminCustomerBreadcrumbLabel } from "@/features/discounts/admin/page-data.server";
import {
  loadAudienceBreadcrumbLabel,
  loadCampaignBreadcrumbLabel,
} from "@/features/email-campaigns/admin/campaign-page-data.server";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

const recordLabelLoaders = new Map<
  AdministrationRecordArea,
  AdministrationRecordLabelLoader
>([
  ["bookings", loadAdministrationBookingBreadcrumbLabel],
  // A customer directory would own this label; discount administration loads
  // it until one exists.
  [
    "customers",
    (customerId, locale) =>
      loadDiscountAdminCustomerBreadcrumbLabel(
        requireDotyposCustomerRouteId(customerId),
        locale
      ),
  ],
  ["email-audiences", (audienceId) => loadAudienceBreadcrumbLabel(audienceId)],
  ["email-campaigns", (campaignId) => loadCampaignBreadcrumbLabel(campaignId)],
  ["invoices", loadInvoiceAdministrationBreadcrumbLabel],
  ["reservations", loadAdministrationReservationBreadcrumbLabel],
]);

/** The breadcrumb trail of a path under `/admin`, with its record's label. */
export async function AdministrationBreadcrumb({
  segments,
}: {
  readonly segments: readonly string[];
}) {
  const recordLabel = await loadAdministrationRecordLabel({
    loaders: recordLabelLoaders,
    locale: await getRequestLocale(),
    segments,
  });

  return (
    <AdministrationBreadcrumbs recordLabel={recordLabel} segments={segments} />
  );
}
