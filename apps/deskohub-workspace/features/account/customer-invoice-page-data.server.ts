import "server-only";

import { Effect } from "effect";
import { notFound } from "next/navigation";
import { CustomerInvoiceService } from "@/features/account/backend/customer-invoice.service";
import { isLocale, type Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

/**
 * Route-boundary loaders for the customer invoice PDF and CSV downloads.
 * Missing, non-owned, unauthenticated, deletion-pending, and flag-disabled
 * requests all fail closed to the same not-found response; a database,
 * decryption, or renderer failure stays a server failure without a document.
 */
export const loadCustomerInvoicePdf = async (invoiceId: string) => {
  const pdf = await Effect.gen(function* () {
    const invoices = yield* CustomerInvoiceService;
    return yield* invoices.findPdf(invoiceId);
  }).pipe(
    Effect.catchTag("CustomerInvoiceNotFoundError", () => Effect.succeed(null)),
    Effect.catchTag("CustomerInvoicesUnavailableError", () =>
      Effect.succeed(null)
    ),
    Effect.provide(CustomerInvoiceService.Live),
    runWorkspaceEffect("account.invoice-pdf", { boundary: "route" })
  );
  if (!pdf) notFound();
  return pdf;
};

export const loadCustomerInvoiceCsv = async (rawLocale: string) => {
  if (!isLocale(rawLocale)) notFound();
  const locale: Locale = rawLocale;
  const csv = await Effect.gen(function* () {
    const invoices = yield* CustomerInvoiceService;
    return yield* invoices.buildCsv(locale);
  }).pipe(
    Effect.catchTag("CustomerInvoicesUnavailableError", () =>
      Effect.succeed(null)
    ),
    Effect.provide(CustomerInvoiceService.Live),
    runWorkspaceEffect("account.invoice-csv", { boundary: "route" })
  );
  if (!csv) notFound();
  return { ...csv, locale };
};
