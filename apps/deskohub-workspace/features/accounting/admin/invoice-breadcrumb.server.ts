import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { authorizeInvoiceAdministrationPage } from "./authorization.server";
import { InvoiceBreadcrumbService } from "./invoice-breadcrumb.service";

export const loadInvoiceAdministrationBreadcrumbLabel = cache(
  async (invoiceId: string) => {
    await authorizeInvoiceAdministrationPage();
    const label = await Effect.gen(function* () {
      const breadcrumb = yield* InvoiceBreadcrumbService;
      return yield* breadcrumb.getLabel(invoiceId);
    }).pipe(
      Effect.catchTag("InvoiceAdministrationNotFoundError", () =>
        Effect.succeed(null)
      ),
      Effect.provide(InvoiceBreadcrumbService.Live),
      runWorkspaceEffect("invoice-administration.breadcrumb", {
        boundary: "route",
      })
    );
    return label ?? undefined;
  }
);
