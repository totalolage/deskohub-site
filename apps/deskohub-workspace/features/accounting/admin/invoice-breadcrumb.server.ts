import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import { m } from "@/features/administration/i18n";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { decodeInvoiceAdministrationId } from "./invoice-administration-identifier";
import { InvoiceBreadcrumbService } from "./invoice-breadcrumb.service";

export const loadInvoiceAdministrationBreadcrumbLabel = cache(
  async (invoiceId: string, locale: Locale) => {
    await authorizeAdministratorPage();
    const invoiceNumber = await Effect.gen(function* () {
      const id = yield* decodeInvoiceAdministrationId(invoiceId);
      const breadcrumb = yield* InvoiceBreadcrumbService;
      return yield* breadcrumb.getInvoiceNumber(id);
    }).pipe(
      Effect.catchTag("InvoiceAdministrationNotFoundError", () =>
        Effect.succeed(null)
      ),
      Effect.provide(InvoiceBreadcrumbService.Live),
      runWorkspaceEffect("invoice-administration.breadcrumb", {
        boundary: "route",
      })
    );
    if (!invoiceNumber) return undefined;
    return m.accountingInvoiceBreadcrumb({ invoiceNumber }, { locale });
  }
);
