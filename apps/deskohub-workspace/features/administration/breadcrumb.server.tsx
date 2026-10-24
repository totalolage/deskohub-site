import "server-only";

import { loadInvoiceAdministrationBreadcrumbLabel } from "@/features/accounting/admin/invoice-breadcrumb.server";
import { AdministrationBreadcrumbs } from "@/features/administration/admin-shell";
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
import { m } from "./i18n";

const newEntityLabels = new Map([
  ["email-audiences", m.shellBreadcrumbNewAudience],
  ["email-campaigns", m.shellBreadcrumbNewCampaign],
]);

/** An automated campaign's section segments, after its ID. */
const campaignSectionLabels = new Map([
  ["email", m.shellBreadcrumbCampaignEmail],
  ["preview", m.shellBreadcrumbCampaignPreview],
  ["runs", m.shellBreadcrumbCampaignRuns],
]);

export async function AdministrationBreadcrumb({
  segments,
}: {
  readonly segments: readonly string[];
}) {
  const locale = await getRequestLocale();
  let entityLabel: string | undefined;

  if (segments[0] === "customers" && segments[1]) {
    entityLabel = await loadDiscountAdminCustomerBreadcrumbLabel(
      requireDotyposCustomerRouteId(segments[1]),
      locale
    );
  } else if (segments[0] === "reservations" && segments[1]) {
    entityLabel =
      (await loadAdministrationReservationBreadcrumbLabel(
        segments[1],
        locale
      )) ?? undefined;
  } else if (segments[0] === "bookings" && segments[1]) {
    entityLabel = await loadAdministrationBookingBreadcrumbLabel(
      segments[1],
      locale
    );
  } else if (
    segments[0] === "invoices" &&
    segments[1] &&
    segments[1] !== "new"
  ) {
    entityLabel = await loadInvoiceAdministrationBreadcrumbLabel(
      segments[1],
      locale
    );
  } else if (segments[0] && segments[1] === "new") {
    entityLabel = newEntityLabels.get(segments[0])?.({}, { locale });
  } else if (segments[0] === "email-campaigns" && segments[1]) {
    entityLabel = await loadCampaignBreadcrumbLabel(segments[1]);
  } else if (segments[0] === "email-audiences" && segments[1]) {
    entityLabel = await loadAudienceBreadcrumbLabel(segments[1]);
  }

  const segmentLabels: Record<string, string> = {};
  if (entityLabel && segments[1]) segmentLabels[segments[1]] = entityLabel;
  if (segments[0] === "email-campaigns" && segments[2]) {
    const sectionLabel = campaignSectionLabels.get(segments[2]);
    if (sectionLabel) segmentLabels[segments[2]] = sectionLabel({}, { locale });
    if (segments[2] === "runs" && segments[3]) {
      segmentLabels[segments[3]] = m.shellBreadcrumbCampaignRun({}, { locale });
    }
  }

  return (
    <AdministrationBreadcrumbs
      entityLabel={segments.length === 2 ? entityLabel : undefined}
      segmentLabels={segmentLabels}
      segments={["admin", ...segments]}
    />
  );
}
