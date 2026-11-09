import "server-only";

import { Effect, type Layer } from "effect";
import { cache } from "react";
import {
  type CustomerInvoiceSummary,
  getCustomerInvoiceStatusLabel,
} from "@/features/accounting/customer-invoice";
import { formatInvoiceTotal } from "@/features/accounting/invoice-settlement";
import type { Locale } from "@/features/i18n";
import {
  catchRecoverableCause,
  runWorkspaceEffectOrElse,
} from "@/shared/backend/workspace-effect";
import { formatPlainDate } from "@/shared/utils/date-time-format";
import { CustomerInvoiceService } from "./backend/customer-invoice.service";
import type {
  CustomerInvoiceHistory,
  CustomerInvoiceHistoryItem,
} from "./contracts";
import {
  getAccountInvoiceExportPath,
  getAccountInvoicePdfPath,
} from "./routes";

/**
 * The signed-in account's issued invoices, formatted in `locale`. It never
 * fails: a refused session reads as `unavailable`, and any other failure,
 * defects included, as `failed`.
 */
export const loadInvoiceHistory = (
  locale: Locale
): Effect.Effect<CustomerInvoiceHistory, never, CustomerInvoiceService> =>
  Effect.flatMap(CustomerInvoiceService, (invoices) => invoices.list).pipe(
    Effect.map(
      (summaries): CustomerInvoiceHistory =>
        summaries.length === 0
          ? { kind: "empty" }
          : {
              kind: "populated",
              invoices: summaries.map((invoice) =>
                toHistoryItem(invoice, locale)
              ),
              exportPath: getAccountInvoiceExportPath(locale),
            }
    ),
    Effect.catchTags({
      CustomerInvoicesUnavailableError: () =>
        Effect.succeed<CustomerInvoiceHistory>({ kind: "unavailable" }),
      CustomerInvoicesLoadError: () =>
        Effect.succeed<CustomerInvoiceHistory>({ kind: "failed" }),
    }),
    failedOnAnyCause
  );

/**
 * Loads the invoice history behind the page's runtime edge, once per render
 * and locale, so the account page can stream it apart from its own state.
 * A service or runtime that can't be built reads as `failed` too. Tests pass
 * a fake `service`.
 */
export const loadCustomerInvoiceHistory = cache(
  (
    locale: Locale,
    service: Layer.Layer<
      CustomerInvoiceService,
      unknown
    > = CustomerInvoiceService.Live
  ): Promise<CustomerInvoiceHistory> =>
    loadInvoiceHistory(locale).pipe(
      Effect.provide(service),
      runWorkspaceEffectOrElse("account.invoice-history", {
        boundary: "page",
        failureCode: "account.invoice-history",
        orElse: (): CustomerInvoiceHistory => ({ kind: "failed" }),
      })
    )
);

const toHistoryItem = (
  invoice: CustomerInvoiceSummary,
  locale: Locale
): CustomerInvoiceHistoryItem => ({
  invoice,
  display: {
    issuedOn: formatPlainDate({
      date: Temporal.PlainDate.from(invoice.issuedOn),
      locale,
    }),
    total: formatInvoiceTotal(invoice.total, locale),
    status: getCustomerInvoiceStatusLabel(invoice.paymentStatus, locale),
    dueDate:
      invoice.dueDate === null
        ? null
        : formatPlainDate({
            date: Temporal.PlainDate.from(invoice.dueDate),
            locale,
          }),
  },
  pdfPath: getAccountInvoicePdfPath(locale, invoice.id),
});

/** Degrades a defect or a failed build to `failed`, logging a fixed code. */
const failedOnAnyCause = catchRecoverableCause(() =>
  Effect.logError("Customer invoice history failed", {
    failureCode: "account.invoice-history",
  }).pipe(Effect.as<CustomerInvoiceHistory>({ kind: "failed" }))
);
