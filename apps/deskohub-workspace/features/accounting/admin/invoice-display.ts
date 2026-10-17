import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import type { AdministrationCustomerName } from "@/features/administration/customer-name";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { findWorkspaceCurrencyDefinition } from "@/shared/money/currencies";
import type {
  InvoiceAdministrationCustomerErrorReason,
  InvoiceAdministrationListItem,
} from "./invoice-administration.service";

export const getInvoiceSourceLabel = (
  source: InvoiceAdministrationListItem["source"],
  locale: Locale
) =>
  ({
    "reservation-request": m.accountingInvoiceSourceReservationRequest,
    "post-order-link": m.accountingInvoiceSourcePostOrderLink,
    "admin-ui": m.accountingInvoiceSourceAdminUi,
    "dhw-cli": m.accountingInvoiceSourceDhwCli,
    legacy: m.accountingInvoiceSourceLegacy,
  })[source]({}, { locale });

/** Formats the decimal invoice total; render it on the server. */
export const formatInvoiceTotal = (
  invoice: Pick<InvoiceAdministrationListItem, "currency" | "total">,
  locale: Locale
) =>
  formatCurrencyAmount({
    amount: Number(invoice.total),
    currency: invoice.currency,
    locale,
    fractionDigits: findWorkspaceCurrencyDefinition(invoice.currency)?.exponent,
  });

/** The operator message for a rejected customer or billing detail. */
export const getInvoiceCustomerErrorMessage = (
  reason: InvoiceAdministrationCustomerErrorReason,
  locale: Locale
) =>
  ({
    "billing-details-invalid": m.accountingInvoiceBillingDetailsInvalid,
    "currency-not-payable": m.accountingInvoiceCurrencyNotPayable,
    "customer-deleted": m.accountingInvoiceCustomerDeleted,
    "customer-email-ambiguous": m.accountingInvoiceCustomerEmailAmbiguous,
    "customer-id-invalid": m.accountingInvoiceCustomerIdInvalid,
    "customer-id-missing": m.accountingInvoiceCustomerIdMissing,
    "invoice-id-reused": m.accountingInvoiceIdReused,
  })[reason]({}, { locale });

/** Names a customer in the operator's language when Dotypos holds no name or email for them. */
export const getInvoiceCustomerName = (
  customer: AdministrationCustomerName,
  locale: Locale
) =>
  customer.hasName
    ? customer.displayName
    : m.accountingUnnamedCustomer({}, { locale });
