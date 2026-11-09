import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import { m } from "@/features/administration/i18n";
import { runAdministrationPage } from "@/features/administrators/server/administration-request.server";
import type { Locale } from "@/features/i18n";
import { decodeInvoiceAdministrationId } from "./invoice-administration-identifier";
import { InvoiceBreadcrumbService } from "./invoice-breadcrumb.service";

export const loadInvoiceAdministrationBreadcrumbLabel = cache(
  async (invoiceId: string, locale: Locale) => {
    const invoiceNumber = await runAdministrationPage(
      "invoice-administration.breadcrumb",
      Effect.gen(function* () {
        const id = yield* decodeInvoiceAdministrationId(invoiceId);
        const breadcrumb = yield* InvoiceBreadcrumbService;
        return yield* breadcrumb.getInvoiceNumber(id);
      }).pipe(
        Effect.catchTag("InvoiceAdministrationNotFoundError", () =>
          Effect.succeed(null)
        )
      ),
      InvoiceBreadcrumbService.Live
    );
    if (!invoiceNumber) return undefined;
    return m.accountingInvoiceBreadcrumb({ invoiceNumber }, { locale });
  }
);
