import { Match } from "effect";
import type { Invoice } from "@/features/accounting/backend/invoice.repository";
import type { InvoiceNumber } from "@/features/accounting/invoice";
import {
  getInvoicePaymentStatus,
  getInvoiceSettlement,
  getInvoiceTotal,
  type InvoicePaymentStatus,
  type InvoiceTotal,
} from "@/features/accounting/invoice-settlement";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import { type Locale, m } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";
import type { CsvColumn } from "@/shared/utils/csv";
import {
  type PlainDate,
  plainDateStringSchema,
  temporalInstantToPlainDate,
} from "@/shared/utils/temporal";

/**
 * What a customer account shows of one issued invoice. Every fact comes from
 * the issued invoice; no current customer or catalog data joins it.
 */
export interface CustomerInvoiceSummary {
  readonly id: InvoiceId;
  readonly invoiceNumber: InvoiceNumber;
  /** The workspace (Prague) calendar date the invoice was issued on. */
  readonly issuedOn: PlainDate;
  readonly total: InvoiceTotal;
  readonly paymentStatus: InvoicePaymentStatus;
  /** The due date while the invoice requests payment, else `null`. */
  readonly dueDate: PlainDate | null;
}

/** `today` is the workspace (Prague) calendar date. */
export const getCustomerInvoiceSummary = (
  invoice: Pick<Invoice, "id" | "issuedAt" | "document">,
  today: PlainDate
): CustomerInvoiceSummary => ({
  id: invoice.id,
  invoiceNumber: invoice.document.invoiceNumber,
  issuedOn: plainDateStringSchema.make(
    temporalInstantToPlainDate({
      instant: invoice.issuedAt,
      timeZone: workspaceSiteConstants.location.timeZone,
    }).toString()
  ),
  total: getInvoiceTotal(invoice.document),
  paymentStatus: getInvoicePaymentStatus(invoice.document, today),
  dueDate: Match.value(getInvoiceSettlement(invoice.document)).pipe(
    Match.tagsExhaustive({
      Paid: () => null,
      NothingDue: () => null,
      PaymentRequested: ({ dueDate }) => dueDate,
    })
  ),
});

export const getCustomerInvoiceStatusLabel = (
  status: InvoicePaymentStatus,
  locale: Locale
) =>
  ({
    paid: m.accountBillingInvoiceStatusPaid,
    issued: m.accountBillingInvoiceStatusIssued,
    due: m.accountBillingInvoiceStatusDue,
    overdue: m.accountBillingInvoiceStatusOverdue,
  })[status]({}, { locale });

/**
 * The customer's invoice export, one row per invoice. Dates stay ISO calendar
 * dates and totals exact decimals, so spreadsheets read them in any locale.
 */
export const getCustomerInvoiceCsvColumns = (
  locale: Locale
): readonly CsvColumn<CustomerInvoiceSummary>[] => [
  {
    header: m.accountBillingInvoiceColumnNumber({}, { locale }),
    value: (invoice) => invoice.invoiceNumber,
  },
  {
    header: m.accountBillingInvoiceColumnIssueDate({}, { locale }),
    value: (invoice) => invoice.issuedOn,
  },
  {
    header: m.accountBillingInvoiceColumnDueDate({}, { locale }),
    value: (invoice) => invoice.dueDate,
  },
  {
    header: m.accountBillingInvoiceColumnTotal({}, { locale }),
    value: (invoice) => invoice.total.amount,
  },
  {
    header: m.accountBillingInvoiceColumnCurrency({}, { locale }),
    value: (invoice) => invoice.total.currency,
  },
  {
    header: m.accountBillingInvoiceColumnStatus({}, { locale }),
    value: (invoice) =>
      getCustomerInvoiceStatusLabel(invoice.paymentStatus, locale),
  },
];
