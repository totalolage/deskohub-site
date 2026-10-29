import { eq, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  invoiceNumberCounters,
  invoices,
  manualInvoiceActors,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import { WorkspaceLocks } from "@/db/workspace-locks";
import {
  formatInvoiceNumber,
  getInvoiceNumberingYear,
  getInvoiceVariableSymbol,
  type InvoiceBuyer,
  type InvoiceDocument,
  type InvoiceNumber,
  invoiceBuyerSchema,
  invoiceDocumentSchema,
  isManualInvoiceDocument,
  type ManualInvoiceDocument,
  makeInvoiceDocument,
  makeManualInvoiceDocument,
} from "@/features/accounting/invoice";
import {
  type InvoiceId,
  isInvoiceCurrencyPayable,
  type ManualInvoiceInput,
  type ManualInvoiceProvenance,
  ManualInvoiceValidationError,
  manualInvoiceInputSchema,
  type NormalizedManualInvoiceInput,
  normalizeManualInvoiceInput,
} from "@/features/accounting/manual-invoice";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import {
  AccountingDocumentSnapshotRepository,
  type AccountingDocumentSnapshotStorageError,
} from "./accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { encryptAccountingSnapshot } from "./accounting-snapshot-sql";
import { InvoiceStorageError, makeInvoiceReads } from "./invoice-reads";

class InvoiceEligibilityError extends Data.TaggedError(
  "InvoiceEligibilityError"
)<{
  readonly paymentAttemptId: string;
  readonly message: string;
}> {}

class ManualInvoiceConflictError extends Data.TaggedError(
  "ManualInvoiceConflictError"
)<{
  readonly invoiceId: string;
  readonly message: string;
}> {}

export interface Invoice {
  readonly id: InvoiceId;
  readonly workspaceReservationId: string | null;
  readonly paymentAttemptId: string | null;
  readonly dotyposCustomerId: string;
  readonly invoiceNumber: InvoiceNumber;
  readonly issuedAt: Temporal.Instant;
  readonly document: InvoiceDocument;
}

interface InvoiceIssuance {
  readonly invoice: Invoice;
  readonly changed: boolean;
}

export interface ReservationInvoice extends Invoice {
  readonly workspaceReservationId: string;
  readonly paymentAttemptId: string;
  readonly document: Exclude<InvoiceDocument, ManualInvoiceDocument>;
}

interface ReservationInvoiceIssuance extends InvoiceIssuance {
  readonly invoice: ReservationInvoice;
}

export interface ManualInvoiceIssuance extends InvoiceIssuance {
  readonly invoice: Invoice & {
    readonly workspaceReservationId: null;
    readonly paymentAttemptId: null;
    readonly document: ManualInvoiceDocument;
  };
}

export type InvoiceRepositoryError =
  | AccountingDocumentSnapshotStorageError
  | EffectDrizzleQueryError
  | InvoiceEligibilityError
  | InvoiceStorageError
  | ManualInvoiceConflictError
  | ManualInvoiceValidationError
  | SqlError;

type ManualInvoiceIssueInput = ManualInvoiceInput & {
  readonly issuedBy: AdministratorAccountActor;
};

export interface IInvoiceRepository {
  readonly findById: (
    invoiceId: string
  ) => Effect.Effect<
    Invoice | null,
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  readonly findByPaymentAttemptId: (
    paymentAttemptId: string
  ) => Effect.Effect<
    ReservationInvoice | null,
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  readonly issue: (input: {
    readonly paymentAttemptId: string;
    readonly buyer: InvoiceBuyer;
    readonly provenance?: {
      readonly source: "reservation-request" | "post-order-link";
    };
  }) => Effect.Effect<ReservationInvoiceIssuance, InvoiceRepositoryError>;
  /**
   * Issues a manual invoice and records the administrator account that
   * issued it in the same transaction. A retry returns the issued invoice.
   */
  readonly issueManual: (
    input: ManualInvoiceIssueInput
  ) => Effect.Effect<ManualInvoiceIssuance, InvoiceRepositoryError>;
  /** Decrypts every invoice. */
  readonly list: () => Effect.Effect<
    readonly Invoice[],
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  /** Decrypts every manual invoice to read who issued it, and through what. */
  readonly listManualInvoiceProvenance: () => Effect.Effect<
    readonly {
      readonly invoiceId: InvoiceId;
      readonly provenance: ManualInvoiceProvenance;
    }[],
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  readonly getSuggestedVariableSymbol: () => Effect.Effect<
    string,
    EffectDrizzleQueryError
  >;
}

const invoiceStorage = Layer.merge(
  WorkspaceDatabase.Default,
  AccountingSnapshotKeyService.Default
);

export class InvoiceRepository extends Context.Service<
  InvoiceRepository,
  IInvoiceRepository
>()("@deskohub-workspace/accounting/InvoiceRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;
      const accountingSnapshots = yield* AccountingDocumentSnapshotRepository;
      const keys = yield* AccountingSnapshotKeyService;
      const reads = yield* makeInvoiceReads;
      const { findById, findByPaymentAttemptId } = reads;

      const issue = Effect.fn("InvoiceRepository.issue")(function* (input: {
        readonly paymentAttemptId: string;
        readonly buyer: InvoiceBuyer;
        readonly provenance?: {
          readonly source: "reservation-request" | "post-order-link";
        };
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

        const buyer = yield* Schema.decodeUnknownEffect(invoiceBuyerSchema, {
          onExcessProperty: "error",
        })(input.buyer).pipe(
          Effect.mapError(
            () =>
              new InvoiceEligibilityError({
                paymentAttemptId,
                message: "Complete invoice buyer billing details are required.",
              })
          )
        );

        const outcome = yield* transaction(
          Effect.gen(function* () {
            const [locked] = yield* db
              .select({
                reservationId: workspaceReservations.id,
                reservationPaymentState: workspaceReservations.paymentState,
                activePaymentAttemptId:
                  workspaceReservations.activePaymentAttemptId,
                dotyposCustomerId: workspaceReservations.dotyposCustomerId,
                dotyposReservationId:
                  workspaceReservations.dotyposReservationId,
                paidAt: workspaceReservations.paidAt,
                fulfillmentState: workspaceReservations.fulfillmentState,
                fulfilledAt: workspaceReservations.fulfilledAt,
                paymentAttemptState: paymentAttempts.state,
              })
              .from(paymentAttempts)
              .innerJoin(
                workspaceReservations,
                eq(
                  workspaceReservations.id,
                  paymentAttempts.workspaceReservationId
                )
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

            const [existing] = yield* db
              .select({ paymentAttemptId: invoices.paymentAttemptId })
              .from(invoices)
              .where(eq(invoices.workspaceReservationId, locked.reservationId))
              .limit(1);

            if (existing) {
              if (existing.paymentAttemptId !== paymentAttemptId) {
                return yield* wrapInvoiceEligibilityError(
                  paymentAttemptId,
                  "The reservation was invoiced from a different payment attempt."
                );
              }

              return {
                paymentAttemptId: existing.paymentAttemptId,
                changed: false,
              };
            }

            if (
              locked.paymentAttemptState !== "paid" ||
              locked.reservationPaymentState !== "paid" ||
              locked.activePaymentAttemptId !== paymentAttemptId ||
              locked.paidAt === null
            ) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "Only the active paid attempt of a paid reservation can be invoiced."
              );
            }

            if (
              locked.fulfillmentState !== "fulfilled" ||
              locked.fulfilledAt === null
            ) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "Only a reservation whose access code has been delivered can be invoiced."
              );
            }

            if (
              source.workspaceReservationId !== locked.reservationId ||
              source.dotyposCustomerId !== locked.dotyposCustomerId ||
              source.dotyposReservationId !== locked.dotyposReservationId
            ) {
              return yield* wrapInvoiceEligibilityError(
                paymentAttemptId,
                "The accounting snapshot does not match the paid reservation."
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
            const [counter] = yield* db
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
                provenance: input.provenance,
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

            yield* db
              .insert(invoices)
              .values({
                workspaceReservationId: locked.reservationId,
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

      const issueManual = Effect.fn("InvoiceRepository.issueManual")(function* (
        issueInput: ManualInvoiceIssueInput
      ) {
        const { issuedBy, ...rawInput } = issueInput;
        const input = yield* Schema.decodeUnknownEffect(
          manualInvoiceInputSchema,
          { onExcessProperty: "error" }
        )(rawInput).pipe(
          Effect.mapError(
            () =>
              new ManualInvoiceValidationError({
                message: "Manual invoice input is invalid.",
              })
          )
        );
        const normalized = yield* normalizeManualInvoiceInput(input);
        const existingInvoice = yield* findById(normalized.invoiceId);
        if (existingInvoice) {
          yield* validateManualInvoiceRetry({
            invoice: existingInvoice,
            normalized,
          });
          if (!isManualInvoiceDocument(existingInvoice.document)) {
            return yield* new ManualInvoiceConflictError({
              invoiceId: normalized.invoiceId,
              message: "Invoice id is already used by a reservation invoice.",
            });
          }
          return {
            invoice: {
              ...existingInvoice,
              workspaceReservationId: null,
              paymentAttemptId: null,
              document: existingInvoice.document,
            },
            changed: false,
          };
        }
        if (!isInvoiceCurrencyPayable(normalized.currency)) {
          return yield* new ManualInvoiceValidationError({
            message:
              "No receiving account is configured for the invoice currency.",
          });
        }

        const outcome = yield* transaction(
          Effect.gen(function* () {
            yield* WorkspaceLocks.manualInvoiceIssue(normalized.invoiceId);
            const [existing] = yield* db
              .select({ id: invoices.id })
              .from(invoices)
              .where(eq(invoices.id, normalized.invoiceId))
              .limit(1);
            if (existing) return { changed: false } as const;

            const key = yield* keys.getActive.pipe(
              Effect.mapError(
                (cause) =>
                  new InvoiceStorageError({
                    operation: "encrypt",
                    paymentAttemptId: normalized.invoiceId,
                    message: "Invoice encryption key is unavailable.",
                    cause: censorLogValue(cause),
                  })
              )
            );
            const issuedAt = Temporal.Instant.from(
              temporalInstantToIsoString(Temporal.Now.instant())
            );
            const numberingYear = getInvoiceNumberingYear(issuedAt);
            const [counter] = yield* db
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
                paymentAttemptId: normalized.invoiceId,
                message: "Invoice number allocation returned no row.",
              });
            }

            const invoiceNumber = formatInvoiceNumber({
              year: numberingYear,
              sequence: counter.sequence,
            });
            const document = makeManualInvoiceDocument({
              normalized,
              invoiceNumber,
              issuedAt,
            });
            yield* db
              .insert(invoices)
              .values({
                id: normalized.invoiceId,
                workspaceReservationId: null,
                paymentAttemptId: null,
                dotyposCustomerId: normalized.dotyposCustomerId,
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
                      paymentAttemptId: normalized.invoiceId,
                      message: "Invoice could not be encrypted.",
                      cause: censorLogValue(cause),
                    })
                )
              );
            yield* db.insert(manualInvoiceActors).values({
              invoiceId: normalized.invoiceId,
              actorAccountId: issuedBy.accountId,
              actorAccountEmail: issuedBy.email,
            });
            return { changed: true } as const;
          })
        );

        const invoice = yield* findById(normalized.invoiceId);
        if (!invoice) {
          return yield* new InvoiceStorageError({
            operation: "load",
            paymentAttemptId: normalized.invoiceId,
            message: "Issued invoice could not be loaded.",
          });
        }
        yield* validateManualInvoiceRetry({ invoice, normalized });
        if (!isManualInvoiceDocument(invoice.document)) {
          return yield* new ManualInvoiceConflictError({
            invoiceId: normalized.invoiceId,
            message: "Invoice id is already used by a reservation invoice.",
          });
        }
        return {
          invoice: {
            ...invoice,
            workspaceReservationId: null,
            paymentAttemptId: null,
            document: invoice.document,
          },
          changed: outcome.changed,
        };
      });

      const getSuggestedVariableSymbol = Effect.fn(
        "InvoiceRepository.getSuggestedVariableSymbol"
      )(function* () {
        const issuedAt = Temporal.Now.instant();
        const numberingYear = getInvoiceNumberingYear(issuedAt);
        const [counter] = yield* db
          .select({ sequence: invoiceNumberCounters.lastSequence })
          .from(invoiceNumberCounters)
          .where(eq(invoiceNumberCounters.numberingYear, numberingYear))
          .limit(1);
        return getInvoiceVariableSymbol(
          formatInvoiceNumber({
            year: numberingYear,
            sequence: (counter?.sequence ?? 0) + 1,
          })
        );
      });

      return {
        ...reads,
        issue,
        issueManual,
        getSuggestedVariableSymbol,
      } satisfies IInvoiceRepository;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.merge(
        invoiceStorage,
        AccountingDocumentSnapshotRepository.Default.pipe(
          Layer.provide(invoiceStorage)
        )
      )
    )
  );
}

const wrapInvoiceEligibilityError = (
  paymentAttemptId: string,
  message: string
) => new InvoiceEligibilityError({ paymentAttemptId, message });

const validateManualInvoiceRetry = Effect.fn(
  "InvoiceRepository.validateManualInvoiceRetry"
)(function* (input: {
  readonly invoice: Invoice;
  readonly normalized: NormalizedManualInvoiceInput;
}) {
  if (!isManualInvoiceDocument(input.invoice.document)) {
    return yield* new ManualInvoiceConflictError({
      invoiceId: input.normalized.invoiceId,
      message: "Invoice id is already used by a reservation invoice.",
    });
  }
  const expected = makeManualInvoiceDocument({
    normalized: input.normalized,
    invoiceNumber: input.invoice.invoiceNumber,
    issuedAt: input.invoice.issuedAt,
  });
  if (JSON.stringify(expected) !== JSON.stringify(input.invoice.document)) {
    return yield* new ManualInvoiceConflictError({
      invoiceId: input.normalized.invoiceId,
      message: "Invoice id was already used with different input.",
    });
  }
});
