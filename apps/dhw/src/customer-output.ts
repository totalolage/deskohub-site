import type {
  AdministrationCustomerSummaryType,
  AdministrationCustomerType,
} from "@deskohub/workspace-admin-api";

/** How to reach a customer: email first, then phone. */
export const formatCustomerContact = (
  customer: Pick<AdministrationCustomerType, "email" | "phone"> | null
) => customer?.email ?? customer?.phone ?? "No contact details";

export const formatCustomerSummaryRow = (
  summary: AdministrationCustomerSummaryType
) =>
  [
    summary.customerId,
    summary.customer?.displayName ?? "Details unavailable",
    formatCustomerContact(summary.customer),
    `${summary.reservationCount} reservations`,
    summary.lastActivityAt,
  ].join("\t");
