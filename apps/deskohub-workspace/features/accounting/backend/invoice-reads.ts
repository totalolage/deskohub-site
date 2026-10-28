import { eq, isNull, type SQL } from "drizzle-orm";
import { Data, Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoices } from "@/db/schema";
import {
  decodeInvoiceDocument,
  type InvoiceDocument,
  isManualInvoiceDocument,
} from "@/features/accounting/invoice";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { decryptAccountingSnapshot } from "./accounting-snapshot-sql";
import type { Invoice, ReservationInvoice } from "./invoice.repository";

export class InvoiceStorageError extends Data.TaggedError(
  "InvoiceStorageError"
)<{
  readonly operation: "decrypt" | "encrypt" | "load" | "parse" | "validate";
  readonly paymentAttemptId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Reads and decrypts stored invoices for `InvoiceRepository`. The listings
 * load every invoice side by side, which no file that opens transactions may
 * state, so they live apart from the repository's issuance transactions.
 * Called inside a transaction, as the legacy administrator backfill does,
 * they load one invoice at a time.
 */
export const makeInvoiceReads = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const keys = yield* AccountingSnapshotKeyService;

  const loadInvoice = Effect.fn("InvoiceRepository.loadInvoice")(
    function* (input: { readonly where: SQL; readonly lookupId: string }) {
      const [metadata] = yield* db
        .select({ keyId: invoices.keyId })
        .from(invoices)
        .where(input.where)
        .limit(1);

      if (!metadata) return null;

      const key = yield* keys.getById(metadata.keyId).pipe(
        Effect.mapError(
          (cause) =>
            new InvoiceStorageError({
              operation: "decrypt",
              paymentAttemptId: input.lookupId,
              message: "Invoice decryption key is unavailable.",
              cause: censorLogValue(cause),
            })
        )
      );

      const [row] = yield* db
        .select({
          id: invoices.id,
          workspaceReservationId: invoices.workspaceReservationId,
          paymentAttemptId: invoices.paymentAttemptId,
          dotyposCustomerId: invoices.dotyposCustomerId,
          invoiceNumber: invoices.invoiceNumber,
          issuedAt: invoices.issuedAt,
          documentJson: decryptAccountingSnapshot(
            invoices.encryptedDocument,
            key.secret
          ),
        })
        .from(invoices)
        .where(input.where)
        .limit(1)
        .pipe(
          Effect.withTracerEnabled(false),
          Effect.mapError(
            (cause) =>
              new InvoiceStorageError({
                operation: "decrypt",
                paymentAttemptId: input.lookupId,
                message: "Invoice could not be decrypted.",
                cause: censorLogValue(cause),
              })
          )
        );

      if (!row) {
        return yield* new InvoiceStorageError({
          operation: "load",
          paymentAttemptId: input.lookupId,
          message: "Invoice disappeared while loading.",
        });
      }

      const encoded = yield* Effect.try({
        try: () => JSON.parse(row.documentJson) as unknown,
        catch: () =>
          new InvoiceStorageError({
            operation: "parse",
            paymentAttemptId: input.lookupId,
            message: "Invoice JSON is invalid.",
          }),
      });
      const document = yield* decodeInvoiceDocument(encoded).pipe(
        Effect.mapError(
          () =>
            new InvoiceStorageError({
              operation: "parse",
              paymentAttemptId: input.lookupId,
              message: "Invoice schema is invalid.",
            })
        )
      );

      yield* validateStoredInvoice({ row, document });

      return {
        id: invoiceIdSchema.make(row.id),
        workspaceReservationId: row.workspaceReservationId,
        paymentAttemptId: row.paymentAttemptId,
        dotyposCustomerId: row.dotyposCustomerId,
        invoiceNumber: document.invoiceNumber,
        issuedAt: row.issuedAt,
        document,
      } satisfies Invoice;
    }
  );

  const findById = Effect.fn("InvoiceRepository.findById")(
    (invoiceId: string) =>
      loadInvoice({
        where: eq(invoices.id, invoiceIdSchema.make(invoiceId)),
        lookupId: invoiceId,
      })
  );

  const findByPaymentAttemptId = Effect.fn(
    "InvoiceRepository.findByPaymentAttemptId"
  )((paymentAttemptId: string) =>
    loadInvoice({
      where: eq(
        invoices.paymentAttemptId,
        paymentAttemptIdSchema.make(paymentAttemptId)
      ),
      lookupId: paymentAttemptId,
    }).pipe(
      Effect.map((invoice) =>
        invoice && !isManualInvoiceDocument(invoice.document)
          ? ({
              ...invoice,
              document: invoice.document,
            } as ReservationInvoice)
          : null
      )
    )
  );

  const list = Effect.fn("InvoiceRepository.list")(function* () {
    const rows = yield* db.select({ id: invoices.id }).from(invoices);
    // ponytail: decrypting the small invoice ledger in-process keeps one
    // repository path; add SQL pagination when the ledger is measurably large.
    const loaded = yield* Effect.all(
      rows.map(({ id }) => findById(id)),
      { concurrency: "inherit" }
    );
    return loaded.filter((invoice) => invoice !== null);
  });

  const listManualInvoiceProvenance = Effect.fn(
    "InvoiceRepository.listManualInvoiceProvenance"
  )(function* () {
    const rows = yield* db
      .select({ id: invoices.id })
      .from(invoices)
      .where(isNull(invoices.workspaceReservationId));
    const loaded = yield* Effect.all(
      rows.map(({ id }) => findById(id)),
      { concurrency: "inherit" }
    );
    return loaded.flatMap((invoice) =>
      invoice && isManualInvoiceDocument(invoice.document)
        ? [
            {
              invoiceId: invoice.document.invoiceId,
              provenance: {
                source: invoice.document.provenance.source,
                actor: invoice.document.provenance.actor,
              },
            },
          ]
        : []
    );
  });

  return {
    findById,
    findByPaymentAttemptId,
    list,
    listManualInvoiceProvenance,
  };
});

const validateStoredInvoice = Effect.fn(
  "InvoiceRepository.validateStoredInvoice"
)(function* (input: {
  readonly row: {
    readonly id: string;
    readonly workspaceReservationId: string | null;
    readonly paymentAttemptId: string | null;
    readonly dotyposCustomerId: string;
    readonly invoiceNumber: string;
    readonly issuedAt: Temporal.Instant;
  };
  readonly document: InvoiceDocument;
}) {
  const { document, row } = input;
  const commonMismatch =
    document.dotyposCustomerId !== row.dotyposCustomerId ||
    document.invoiceNumber !== row.invoiceNumber ||
    Temporal.Instant.compare(
      Temporal.Instant.from(document.issuedAt),
      row.issuedAt
    ) !== 0;
  const sourceMismatch = isManualInvoiceDocument(document)
    ? document.invoiceId !== row.id ||
      row.workspaceReservationId !== null ||
      row.paymentAttemptId !== null
    : document.workspaceReservationId !== row.workspaceReservationId ||
      document.paymentAttemptId !== row.paymentAttemptId;
  if (commonMismatch || sourceMismatch) {
    return yield* new InvoiceStorageError({
      operation: "validate",
      paymentAttemptId: row.paymentAttemptId ?? row.id,
      message: "Invoice metadata does not match its encrypted document.",
    });
  }
});
