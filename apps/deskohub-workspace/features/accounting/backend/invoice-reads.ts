import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, asc, desc, eq, isNull, type SQL } from "drizzle-orm";
import { Data, Effect, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { accountingDocumentSnapshots, invoices } from "@/db/schema";
import {
  decodeInvoiceDocument,
  type InvoiceDocument,
  isManualInvoiceDocument,
} from "@/features/accounting/invoice";
import {
  type InvoiceId,
  invoiceIdSchema,
} from "@/features/accounting/manual-invoice";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import {
  readLimitSentinel,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { decryptAccountingSnapshot } from "./accounting-snapshot-sql";
import type {
  Invoice,
  InvoiceMetadata,
  ReservationInvoice,
} from "./invoice.repository";

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
 * they load one invoice at a time. Customer reads filter by the Dotypos
 * customer in the same SQL that decrypts, so no other customer's document is
 * ever decrypted.
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
    }).pipe(Effect.map(asReservationInvoice))
  );

  /** A reservation has at most one invoice (`invoices_reservation_unique_idx`). */
  const findByReservationId = Effect.fn(
    "InvoiceRepository.findByReservationId"
  )((reservationId: WorkspaceReservationId) =>
    loadInvoice({
      where: eq(invoices.workspaceReservationId, reservationId),
      lookupId: reservationId,
    }).pipe(Effect.map(asReservationInvoice))
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

  const loadCustomerInvoice = (
    dotyposCustomerId: DotyposCustomerId,
    invoiceId: InvoiceId
  ) =>
    loadInvoice({
      // `and` of defined conditions is never undefined.
      where: and(
        eq(invoices.id, invoiceId),
        eq(invoices.dotyposCustomerId, dotyposCustomerId)
      )!,
      lookupId: invoiceId,
    });

  /** The customer's issued invoices, newest issue first. */
  const listForCustomer = Effect.fn("InvoiceRepository.listForCustomer")(
    function* (dotyposCustomerId: DotyposCustomerId) {
      const rows = yield* db
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.dotyposCustomerId, dotyposCustomerId))
        .orderBy(desc(invoices.issuedAt), desc(invoices.invoiceNumber));
      const loaded = yield* Effect.all(
        rows.map(({ id }) =>
          loadCustomerInvoice(dotyposCustomerId, invoiceIdSchema.make(id))
        ),
        { concurrency: "inherit" }
      );
      return loaded.filter((invoice) => invoice !== null);
    }
  );

  /**
   * The customer's invoice metadata, oldest issue first. Selects no document
   * or key column, so nothing is decrypted.
   */
  const listMetadataForCustomer = Effect.fn(
    "InvoiceRepository.listMetadataForCustomer"
  )(function* (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly limit: number;
  }) {
    const rows: readonly InvoiceMetadata[] = yield* db
      .select({
        invoiceNumber: invoices.invoiceNumber,
        issuedAt: invoices.issuedAt,
        numberingYear: invoices.numberingYear,
        numberingSequence: invoices.numberingSequence,
        workspaceReservationId: invoices.workspaceReservationId,
        paymentAttemptId: invoices.paymentAttemptId,
        documentSnapshotRecordedAt: accountingDocumentSnapshots.createdAt,
      })
      .from(invoices)
      .leftJoin(
        accountingDocumentSnapshots,
        eq(
          accountingDocumentSnapshots.paymentAttemptId,
          invoices.paymentAttemptId
        )
      )
      .where(eq(invoices.dotyposCustomerId, input.dotyposCustomerId))
      .orderBy(asc(invoices.issuedAt), asc(invoices.id))
      .limit(readLimitSentinel(input.limit));
    return yield* requireWithinReadLimit(rows, input.limit);
  });

  /**
   * One of the customer's invoices. Another customer's invoice, an unknown id,
   * and text that is no invoice id all read as `null`; the last one without a
   * query.
   */
  const findForCustomer = Effect.fn("InvoiceRepository.findForCustomer")(
    (dotyposCustomerId: DotyposCustomerId, invoiceId: string) =>
      Option.match(decodeInvoiceId(invoiceId), {
        onNone: () => Effect.succeed(null),
        onSome: (id) => loadCustomerInvoice(dotyposCustomerId, id),
      })
  );

  return {
    findById,
    findByPaymentAttemptId,
    findByReservationId,
    findForCustomer,
    list,
    listForCustomer,
    listManualInvoiceProvenance,
    listMetadataForCustomer,
  };
});

const decodeInvoiceId = Schema.decodeUnknownOption(invoiceIdSchema);

const asReservationInvoice = (invoice: Invoice | null) =>
  invoice && !isManualInvoiceDocument(invoice.document)
    ? ({ ...invoice, document: invoice.document } as ReservationInvoice)
    : null;

interface StoredInvoiceRow {
  readonly id: string;
  readonly workspaceReservationId: string | null;
  readonly paymentAttemptId: string | null;
  readonly dotyposCustomerId: string;
  readonly invoiceNumber: string;
  readonly issuedAt: Temporal.Instant;
}

interface StoredInvoice {
  readonly row: StoredInvoiceRow;
  readonly document: InvoiceDocument;
}

const matchesInvoiceIdentity = ({ document, row }: StoredInvoice) =>
  document.dotyposCustomerId === row.dotyposCustomerId &&
  document.invoiceNumber === row.invoiceNumber &&
  Temporal.Instant.compare(
    Temporal.Instant.from(document.issuedAt),
    row.issuedAt
  ) === 0;

const matchesInvoiceSource = ({ document, row }: StoredInvoice) =>
  isManualInvoiceDocument(document)
    ? document.invoiceId === row.id &&
      row.workspaceReservationId === null &&
      row.paymentAttemptId === null
    : document.workspaceReservationId === row.workspaceReservationId &&
      document.paymentAttemptId === row.paymentAttemptId;

const validateStoredInvoice = Effect.fn(
  "InvoiceRepository.validateStoredInvoice"
)(function* (input: StoredInvoice) {
  if (!matchesInvoiceIdentity(input) || !matchesInvoiceSource(input)) {
    return yield* new InvoiceStorageError({
      operation: "validate",
      paymentAttemptId: input.row.paymentAttemptId ?? input.row.id,
      message: "Invoice metadata does not match its encrypted document.",
    });
  }
});
