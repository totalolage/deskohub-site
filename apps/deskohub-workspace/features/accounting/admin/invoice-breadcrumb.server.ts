import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import { authorizeAdministrationPage } from "@/features/administration/page-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { decodeInvoiceAdministrationId } from "./invoice-administration-identifier";
import { InvoiceBreadcrumbService } from "./invoice-breadcrumb.service";

export const loadInvoiceAdministrationBreadcrumbLabel = cache(
  async (invoiceId: string) => {
    await authorizeAdministrationPage();
    const label = await Effect.gen(function* () {
      const id = yield* decodeInvoiceAdministrationId(invoiceId);
      const breadcrumb = yield* InvoiceBreadcrumbService;
      return yield* breadcrumb.getLabel(id);
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
