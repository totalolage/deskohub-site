import { AdministrationInvoiceId } from "@deskohub/workspace-admin-api";
import { Data, Effect, Schema } from "effect";

export class InvoiceAdministrationNotFoundError extends Data.TaggedError(
  "InvoiceAdministrationNotFoundError"
)<{ readonly invoiceId: string }> {}

export const decodeInvoiceAdministrationId = (invoiceId: string) =>
  Schema.decodeUnknownEffect(AdministrationInvoiceId)(invoiceId).pipe(
    Effect.mapError(() => new InvoiceAdministrationNotFoundError({ invoiceId }))
  );
