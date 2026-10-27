import "server-only";

import { loadInvoiceAdministrationBreadcrumbLabel } from "@/features/accounting/admin/invoice-breadcrumb.server";
import { AdministrationBreadcrumbs } from "@/features/administration/admin-shell";
import {
  type AdministrationRecordArea,
  findAdministrationRecord,
} from "@/features/administration/administration-areas";
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
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

/**
 * Loads the label of an area's record, such as an invoice number, through
 * `runAdministrationPage`. A record without one keeps the area's record label.
 */
type RecordLabelLoader = (
  recordId: string,
  locale: Locale
) => Promise<string | null | undefined>;

const recordLabelLoaders = new Map<AdministrationRecordArea, RecordLabelLoader>(
  [
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
    [
      "email-audiences",
      (audienceId) => loadAudienceBreadcrumbLabel(audienceId),
    ],
    [
      "email-campaigns",
      (campaignId) => loadCampaignBreadcrumbLabel(campaignId),
    ],
    ["invoices", loadInvoiceAdministrationBreadcrumbLabel],
    ["reservations", loadAdministrationReservationBreadcrumbLabel],
  ]
);

/** The breadcrumb trail of a path under `/admin`, with its record's label. */
export async function AdministrationBreadcrumb({
  segments,
}: {
  readonly segments: readonly string[];
}) {
  const locale = await getRequestLocale();
  const record = findAdministrationRecord(segments);
  const loadRecordLabel = record && recordLabelLoaders.get(record.area);
  const recordLabel =
    record && loadRecordLabel
      ? await loadRecordLabel(record.recordId, locale)
      : undefined;

  return (
    <AdministrationBreadcrumbs
      recordLabel={recordLabel ?? undefined}
      segments={segments}
    />
  );
}
