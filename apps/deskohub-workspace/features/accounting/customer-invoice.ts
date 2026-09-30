import { BigDecimal } from "effect";
import {
  getManualInvoicePayment,
  type InvoiceDocument,
  isManualInvoiceDocument,
} from "@/features/accounting/invoice";
import { type Locale, m } from "@/features/i18n";
import { formatInstantDate } from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

/**
 * The closed set of issued-invoice facts the customer account lists. Every
 * value is read from the immutable issued document or the ledger row; no
 * mutable Dotypos customer or catalog data joins this projection.
 */
export interface CustomerInvoiceSummary {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly issuedAt: string;
  readonly total: string;
  readonly currency: string;
  readonly paymentStatus: "paid" | "due";
  readonly dueDate: string | null;
}

export const getCustomerInvoiceSummary = (input: {
  readonly id: string;
  readonly issuedAt: Temporal.Instant;
  readonly document: InvoiceDocument;
}): CustomerInvoiceSummary => {
  const { document } = input;
  if (isManualInvoiceDocument(document)) {
    const payment = getManualInvoicePayment(document);
    const positiveTotal = BigDecimal.isPositive(
      BigDecimal.fromStringUnsafe(document.total)
    );
    return {
      id: input.id,
      invoiceNumber: document.invoiceNumber,
      issuedAt: input.issuedAt.toString(),
      total: document.total,
      currency: document.currency,
      paymentStatus:
        payment.status === "paid" || !positiveTotal ? "paid" : "due",
      dueDate: payment.status === "due" && positiveTotal ? payment.date : null,
    };
  }
  const price = document.quote.payment.expectedPrice;
  return {
    id: input.id,
    invoiceNumber: document.invoiceNumber,
    issuedAt: input.issuedAt.toString(),
    total: formatInvoiceMinorUnits(price.value, price.exponent),
    currency: price.currency,
    paymentStatus: "paid",
    dueDate: null,
  };
};

/**
 * Formats a minor-unit amount as a plain decimal string with the currency's
 * exponent. Shared by the administration list and the customer invoice list
 * so both render the same ledger amount.
 */
export const formatInvoiceMinorUnits = (
  value: number,
  exponent: number
): string => {
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(value)
    .toString()
    .padStart(exponent + 1, "0");
  return exponent === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
};

/**
 * Formats a stored decimal amount for display in the active locale with the
 * invoice's currency. The fraction digits of the stored decimal are pinned as
 * both the minimum and the maximum so localization never rounds or pads the
 * ledger amount; the CSV export keeps the plain decimal instead.
 *
 * The integer digits are formatted as a BigInt so manual invoices — exact
 * BigDecimal arithmetic with bounded scale but unbounded magnitude — keep
 * every digit even beyond the safe-integer range, where a JS number would
 * round. The pinned fraction is appended with the locale's own decimal
 * separator, which reproduces the pinned-fraction currency format exactly;
 * for ordinary amounts the output is identical to number-based formatting.
 */
export const formatInvoiceAmount = (
  total: string,
  currency: string,
  locale: Locale
): string => {
  const separatorIndex = total.indexOf(".");
  const wholePart =
    separatorIndex === -1 ? total : total.slice(0, separatorIndex);
  const fractionPart =
    separatorIndex === -1 ? undefined : total.slice(separatorIndex + 1);
  const fractionDigits = fractionPart === undefined ? 0 : fractionPart.length;
  const integerFormat = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const wholeAmount = BigInt(wholePart);
  if (fractionDigits === 0) return integerFormat.format(wholeAmount);

  // BigInt has no negative zero, so for a negative amount whose integer
  // magnitude is zero (e.g. "-0.25"), format -1n and swap its integer
  // digits for 0 to keep the locale's minus sign.
  const wholeSource =
    wholeAmount === 0n && total.startsWith("-")
      ? integerFormat
          .formatToParts(-1n)
          .map((part) =>
            part.type === "integer" ? { ...part, value: "0" } : part
          )
      : integerFormat.formatToParts(wholeAmount);
  const parts = wholeSource;
  const decimalSeparator =
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
      .formatToParts(1.5)
      .find((part) => part.type === "decimal")?.value ?? ".";
  let lastIntegerPart = -1;
  parts.forEach((part, index) => {
    if (part.type === "integer") lastIntegerPart = index;
  });
  parts.splice(
    lastIntegerPart + 1,
    0,
    { type: "decimal", value: decimalSeparator },
    { type: "fraction", value: fractionPart ?? "" }
  );
  return parts.map((part) => part.value).join("");
};

const escapeCsvField = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/**
 * Renders the customer invoice export as CSV. Headers and statuses follow the
 * export locale; dates are formatted in the workspace timezone, amounts stay
 * plain decimals so the export remains machine-readable.
 */
export const renderCustomerInvoiceCsv = (
  summaries: readonly CustomerInvoiceSummary[],
  locale: Locale
): string => {
  const copy = {
    invoiceNumber: m.invoiceNumberLabel({}, { locale }),
    issueDate: m.invoiceIssueDateLabel({}, { locale }),
    amount: m.invoiceAmountLabel({}, { locale }),
    currency: m.customerInvoiceCsvCurrency({}, { locale }),
    status: m.customerInvoiceCsvStatus({}, { locale }),
    dueDate: m.invoiceManualDueDate({}, { locale }),
    paid: m.invoicePaidStatus({}, { locale }),
    due: m.invoiceManualUnpaid({}, { locale }),
  };
  const header = [
    copy.invoiceNumber,
    copy.issueDate,
    copy.amount,
    copy.currency,
    copy.status,
    copy.dueDate,
  ];
  const rows = summaries.map((summary) => [
    summary.invoiceNumber,
    formatWorkspaceInstantDate(summary.issuedAt, locale),
    summary.total,
    summary.currency,
    summary.paymentStatus === "paid" ? copy.paid : copy.due,
    summary.dueDate ?? "",
  ]);
  return [header, ...rows]
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\r\n");
};

const formatWorkspaceInstantDate = (value: string, locale: Locale) =>
  formatInstantDate({
    instant: Temporal.Instant.from(value),
    locale,
    timeZone: workspaceSiteConstants.location.timeZone,
  });
