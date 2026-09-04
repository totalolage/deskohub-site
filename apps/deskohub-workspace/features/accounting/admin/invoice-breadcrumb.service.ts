import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoices } from "@/db/schema";
import {
  decodeInvoiceAdministrationId,
  type InvoiceAdministrationNotFoundError,
} from "./invoice-administration-identifier";

interface IInvoiceBreadcrumbService {
  readonly getLabel: (
    invoiceId: string
  ) => Effect.Effect<
    string | null,
    InvoiceAdministrationNotFoundError | EffectDrizzleQueryError
  >;
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
        function* (invoiceId: string) {
          const id = yield* decodeInvoiceAdministrationId(invoiceId);
          const [row] = yield* db
            .select({ invoiceNumber: invoices.invoiceNumber })
            .from(invoices)
            .where(eq(invoices.id, id))
            .limit(1);
          return row ? `Invoice ${row.invoiceNumber}` : null;
        }
      );

      return { getLabel } satisfies IInvoiceBreadcrumbService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
