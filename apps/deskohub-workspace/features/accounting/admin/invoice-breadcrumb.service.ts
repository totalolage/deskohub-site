import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoices } from "@/db/schema";
import { decodeInvoiceAdministrationId } from "./invoice-administration.service";

const makeInvoiceBreadcrumbService = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;

  const getLabel = Effect.fn("InvoiceBreadcrumbService.getLabel")(function* (
    invoiceId: string
  ) {
    const id = yield* decodeInvoiceAdministrationId(invoiceId);
    const [row] = yield* db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return row ? `Invoice ${row.invoiceNumber}` : null;
  });

  return { getLabel };
});

export class InvoiceBreadcrumbService extends Context.Service<
  InvoiceBreadcrumbService,
  Effect.Success<typeof makeInvoiceBreadcrumbService>
>()("@deskohub-workspace/accounting/InvoiceBreadcrumbService") {
  static Default = Layer.effect(this, makeInvoiceBreadcrumbService);
  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
