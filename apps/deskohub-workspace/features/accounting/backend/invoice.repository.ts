import { eq, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  invoiceNumberCounters,
  invoices,
  orders,
  paymentAttempts,
} from "@/db/schema";
import {
  type AccountingDocumentSnapshot,
  getAccountingDocumentOrderId,
} from "@/features/accounting/accounting-document-snapshot";
import {
  decodeInvoiceDocument,
  formatInvoiceNumber,
  getInvoiceNumberingYear,
  getInvoiceOrderId,
  type InvoiceBuyer,
  type InvoiceDocument,
  type InvoiceNumber,
  invoiceBuyerSchema,
  invoiceDocumentSchema,
  makeInvoiceDocument,
} from "@/features/accounting/invoice";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import {
  AccountingDocumentSnapshotRepository,
  type AccountingDocumentSnapshotStorageError,
} from "./accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import {
  decryptAccountingSnapshot,
  encryptAccountingSnapshot,
} from "./accounting-snapshot-sql";

export class InvoiceEligibilityError extends Data.TaggedError(
  "InvoiceEligibilityError"
)<{
  readonly paymentAttemptId: string;
  readonly message: string;
}> {}

export class InvoiceStorageError extends Data.TaggedError(
  "InvoiceStorageError"
)<{
  readonly operation: "decrypt" | "encrypt" | "load" | "parse" | "validate";
  readonly paymentAttemptId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface Invoice {
  readonly id: string;
  readonly orderId: string;
  readonly workspaceReservationId: string | null;
  readonly paymentAttemptId: string;
  readonly dotyposCustomerId: string;
  readonly invoiceNumber: InvoiceNumber;
  readonly issuedAt: Temporal.Instant;
  readonly document: InvoiceDocument;
}

export interface InvoiceIssuance {
  readonly invoice: Invoice;
  readonly changed: boolean;
}

export type InvoiceRepositoryError =
  | AccountingDocumentSnapshotStorageError
  | EffectDrizzleQueryError
  | InvoiceEligibilityError
  | InvoiceStorageError
  | SqlError;

export interface IInvoiceRepository {
  readonly findByPaymentAttemptId: (
    paymentAttemptId: string
  ) => Effect.Effect<
    Invoice | null,
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  readonly issue: (input: {
    readonly paymentAttemptId: string;
    readonly buyer?: InvoiceBuyer;
  }) => Effect.Effect<InvoiceIssuance, InvoiceRepositoryError>;
}

export class InvoiceRepository extends Context.Service<
  InvoiceRepository,
  IInvoiceRepository
>()("@deskohub-workspace/accounting/InvoiceRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const accountingSnapshots = yield* AccountingDocumentSnapshotRepository;
      const keys = yield* AccountingSnapshotKeyService;

      const findByPaymentAttemptId = Effect.fn(
        "InvoiceRepository.findByPaymentAttemptId"
      )(function* (paymentAttemptId: string) {
        const decodedPaymentAttemptId =
          paymentAttemptIdSchema.make(paymentAttemptId);
        const [metadata] = yield* db
          .select({ keyId: invoices.keyId })
          .from(invoices)
          .where(eq(invoices.paymentAttemptId, decodedPaymentAttemptId))
          .limit(1);

        if (!metadata) return null;

        const key = yield* keys.getById(metadata.keyId).pipe(
          Effect.mapError(
            (cause) =>
              new InvoiceStorageError({
                operation: "decrypt",
                paymentAttemptId,
                message: "Invoice decryption key is unavailable.",
                cause: censorLogValue(cause),
              })
          )
        );

        const [row] = yield* db
          .select({
            id: invoices.id,
            orderId: invoices.orderId,
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
          .where(eq(invoices.paymentAttemptId, decodedPaymentAttemptId))
          .limit(1)
          .pipe(
            Effect.withTracerEnabled(false),
            Effect.mapError(
              (cause) =>
                new InvoiceStorageError({
                  operation: "decrypt",
                  paymentAttemptId,
                  message: "Invoice could not be decrypted.",
                  cause: censorLogValue(cause),
                })
            )
          );

        if (!row) {
          return yield* new InvoiceStorageError({
            operation: "load",
            paymentAttemptId,
            message: "Invoice disappeared while loading.",
          });
        }

        const encoded = yield* Effect.try({
          try: () => JSON.parse(row.documentJson) as unknown,
          catch: () =>
            new InvoiceStorageError({
              operation: "parse",
              paymentAttemptId,
              message: "Invoice JSON is invalid.",
            }),
        });
        const document = yield* decodeInvoiceDocument(encoded).pipe(
          Effect.mapError(
            () =>
              new InvoiceStorageError({
                operation: "parse",
                paymentAttemptId,
                message: "Invoice schema is invalid.",
              })
          )
        );

        yield* validateStoredInvoice({ row, document });

        return {
          id: row.id,
          orderId: row.orderId ?? getInvoiceOrderId(document),
          workspaceReservationId:
            "workspaceReservationId" in document
              ? document.workspaceReservationId
              : null,
          paymentAttemptId: row.paymentAttemptId,
          dotyposCustomerId: row.dotyposCustomerId,
          invoiceNumber: document.invoiceNumber,
          issuedAt: row.issuedAt,
          document,
        } satisfies Invoice;
      });

      const issue = Effect.fn("InvoiceRepository.issue")(function* (input: {
        readonly paymentAttemptId: string;
        readonly buyer?: InvoiceBuyer;
      }) {
        const paymentAttemptId = paymentAttemptIdSchema.make(
          input.paymentAttemptId
        );
        const alreadyIssued = yield* findByPaymentAttemptId(paymentAttemptId);
        if (alreadyIssued) {
          return { invoice: alreadyIssued, changed: false };
        }

        const source =
          yield* accountingSnapshots.findByPaymentAttemptId(paymentAttemptId);
        if (!source) {
          return yield* new InvoiceEligibilityError({
            paymentAttemptId,
            message: "A payment-time accounting snapshot is required.",
          });
        }

        const buyer = yield* getInvoiceBuyer({
          source,
          submittedBuyer: input.buyer,
          paymentAttemptId,
        });

        const outcome = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const [locked] = yield* tx
              .select({
                orderId: orders.id,
                orderPaymentState: orders.paymentState,
                activePaymentAttemptId: orders.activePaymentAttemptId,
                dotyposCustomerId: orders.dotyposCustomerId,
                paidAt: orders.paidAt,
                fulfillmentState: orders.fulfillmentState,
                fulfilledAt: orders.fulfilledAt,
                paymentAttemptState: paymentAttempts.state,
              })
              .from(paymentAttempts)
              .innerJoin(
                orders,
                sql`${orders.id} = coalesce(${paymentAttempts.orderId}, ${paymentAttempts.workspaceReservationId})`
              )
              .where(eq(paymentAttempts.id, paymentAttemptId))
              .limit(1)
              .for("update");

            if (!locked) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "The payment attempt does not exist."
              );
            }

            const [existing] = yield* tx
              .select({ paymentAttemptId: invoices.paymentAttemptId })
              .from(invoices)
              .where(
                sql`coalesce(${invoices.orderId}, ${invoices.workspaceReservationId}) = ${locked.orderId}`
              )
              .limit(1);

            if (existing) {
              if (existing.paymentAttemptId !== paymentAttemptId) {
                return yield* wrapInvoiceEligibilityError(
                  paymentAttemptId,
                  "The order was invoiced from a different payment attempt."
                );
              }

              return {
                paymentAttemptId: existing.paymentAttemptId,
                changed: false,
              };
            }

            if (
              locked.paymentAttemptState !== "paid" ||
              locked.orderPaymentState !== "paid" ||
              locked.activePaymentAttemptId !== paymentAttemptId ||
              locked.paidAt === null
            ) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "Only the active paid attempt of a paid order can be invoiced."
              );
            }

            if (
              locked.fulfillmentState !== "fulfilled" ||
              locked.fulfilledAt === null
            ) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "Only a fulfilled order can be invoiced."
              );
            }

            if (
              getAccountingDocumentOrderId(source) !== locked.orderId ||
              source.dotyposCustomerId !== locked.dotyposCustomerId ||
              ("orderId" in source &&
                Temporal.Instant.compare(
                  Temporal.Instant.from(source.fulfilledAt),
                  locked.fulfilledAt
                ) !== 0)
            ) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "The accounting snapshot does not match the paid order."
              );
            }

            const key = yield* keys.getActive.pipe(
              Effect.mapError(
                (cause) =>
                  new InvoiceStorageError({
                    operation: "encrypt",
                    paymentAttemptId,
                    message: "Invoice encryption key is unavailable.",
                    cause: censorLogValue(cause),
                  })
              )
            );
            const issuedAt = Temporal.Instant.from(
              temporalInstantToIsoString(Temporal.Now.instant())
            );
            const numberingYear = getInvoiceNumberingYear(issuedAt);
            const [counter] = yield* tx
              .insert(invoiceNumberCounters)
              .values({ numberingYear, lastSequence: 1 })
              .onConflictDoUpdate({
                target: invoiceNumberCounters.numberingYear,
                set: {
                  lastSequence: sql`${invoiceNumberCounters.lastSequence} + 1`,
                },
              })
              .returning({ sequence: invoiceNumberCounters.lastSequence });

            if (!counter) {
              return yield* new InvoiceStorageError({
                operation: "load",
                paymentAttemptId,
                message: "Invoice number allocation returned no row.",
              });
            }

            const invoiceNumber = formatInvoiceNumber({
              year: numberingYear,
              sequence: counter.sequence,
            });
            const document = yield* Schema.decodeUnknownEffect(
              invoiceDocumentSchema,
              { onExcessProperty: "error" }
            )(
              makeInvoiceDocument({
                source,
                buyer,
                paymentAttemptId,
                invoiceNumber,
                issuedAt,
                fulfilledAt: locked.fulfilledAt,
                paidAt: locked.paidAt,
              })
            ).pipe(
              Effect.mapError(
                () =>
                  new InvoiceStorageError({
                    operation: "validate",
                    paymentAttemptId,
                    message: "Invoice schema is invalid.",
                  })
              )
            );

            yield* tx
              .insert(invoices)
              .values({
                orderId: locked.orderId,
                workspaceReservationId:
                  "workspaceReservationId" in source
                    ? source.workspaceReservationId
                    : null,
                paymentAttemptId,
                dotyposCustomerId: locked.dotyposCustomerId,
                invoiceNumber,
                numberingYear,
                numberingSequence: counter.sequence,
                keyId: key.id,
                encryptedDocument: encryptAccountingSnapshot(
                  JSON.stringify(document),
                  key.secret
                ),
                issuedAt,
              })
              .pipe(
                Effect.withTracerEnabled(false),
                Effect.mapError(
                  (cause) =>
                    new InvoiceStorageError({
                      operation: "encrypt",
                      paymentAttemptId,
                      message: "Invoice could not be encrypted.",
                      cause: censorLogValue(cause),
                    })
                )
              );

            return { paymentAttemptId, changed: true };
          })
        );

        const invoice = yield* findByPaymentAttemptId(outcome.paymentAttemptId);
        if (!invoice) {
          return yield* new InvoiceStorageError({
            operation: "load",
            paymentAttemptId: outcome.paymentAttemptId,
            message: "Issued invoice could not be loaded.",
          });
        }

        return { invoice, changed: outcome.changed };
      });

      return { findByPaymentAttemptId, issue } satisfies IInvoiceRepository;
    })
  );
}

const wrapInvoiceEligibilityError = (
  paymentAttemptId: string,
  message: string
) => new InvoiceEligibilityError({ paymentAttemptId, message });

const getInvoiceBuyer = Effect.fn("InvoiceRepository.getInvoiceBuyer")(
  function* (input: {
    readonly source: AccountingDocumentSnapshot;
    readonly submittedBuyer?: InvoiceBuyer;
    readonly paymentAttemptId: string;
  }) {
    if ("orderId" in input.source) {
      if (
        input.source.billing.invoice === "none" ||
        input.submittedBuyer !== undefined
      ) {
        return yield* wrapInvoiceEligibilityError(
          input.paymentAttemptId,
          "Goods invoice identity must come from its frozen billing instruction."
        );
      }
      return yield* Schema.decodeUnknownEffect(invoiceBuyerSchema, {
        onExcessProperty: "error",
      })(input.source.buyer).pipe(
        Effect.mapError(() =>
          wrapInvoiceEligibilityError(
            input.paymentAttemptId,
            "Complete frozen goods invoice buyer details are required."
          )
        )
      );
    }
    return yield* Schema.decodeUnknownEffect(invoiceBuyerSchema, {
      onExcessProperty: "error",
    })(input.submittedBuyer).pipe(
      Effect.mapError(() =>
        wrapInvoiceEligibilityError(
          input.paymentAttemptId,
          "Complete invoice buyer billing details are required."
        )
      )
    );
  }
);

const validateStoredInvoice = Effect.fn(
  "InvoiceRepository.validateStoredInvoice"
)(function* (input: {
  readonly row: {
    readonly orderId: string | null;
    readonly workspaceReservationId: string | null;
    readonly paymentAttemptId: string;
    readonly dotyposCustomerId: string;
    readonly invoiceNumber: string;
    readonly issuedAt: Temporal.Instant;
  };
  readonly document: InvoiceDocument;
}) {
  const { document, row } = input;
  const workspaceReservationId =
    "workspaceReservationId" in document
      ? document.workspaceReservationId
      : null;
  if (
    (row.orderId ?? row.workspaceReservationId) !==
      getInvoiceOrderId(document) ||
    row.workspaceReservationId !== workspaceReservationId ||
    document.paymentAttemptId !== row.paymentAttemptId ||
    document.dotyposCustomerId !== row.dotyposCustomerId ||
    document.invoiceNumber !== row.invoiceNumber ||
    Temporal.Instant.compare(
      Temporal.Instant.from(document.issuedAt),
      row.issuedAt
    ) !== 0
  ) {
    return yield* new InvoiceStorageError({
      operation: "validate",
      paymentAttemptId: row.paymentAttemptId,
      message: "Invoice metadata does not match its encrypted document.",
    });
  }
});
