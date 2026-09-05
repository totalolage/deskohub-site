import type { AdministrationInvoiceIdType } from "@deskohub/workspace-admin-api";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoices } from "@/db/schema";

interface IInvoiceBreadcrumbService {
  readonly getLabel: (
    invoiceId: AdministrationInvoiceIdType
  ) => Effect.Effect<string | null, EffectDrizzleQueryError>;
}

export class InvoiceBreadcrumbService extends Context.Service<
  InvoiceBreadcrumbService,
  IInvoiceBreadcrumbService
>()("@deskohub-workspace/accounting/InvoiceBreadcrumbService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const getLabel = Effect.fn("InvoiceBreadcrumbService.getLabel")(
        function* (invoiceId: AdministrationInvoiceIdType) {
          const [row] = yield* db
            .select({ invoiceNumber: invoices.invoiceNumber })
            .from(invoices)
            .where(eq(invoices.id, invoiceId))
            .limit(1);
          return row ? `Invoice ${row.invoiceNumber}` : null;
        }
      );

      return { getLabel } satisfies IInvoiceBreadcrumbService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
