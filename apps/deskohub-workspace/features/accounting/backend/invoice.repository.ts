import { eq, type SQL, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  invoiceEmailDeliveries,
  invoiceNumberCounters,
  invoices,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import {
  decodeInvoiceDocument,
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
  invoiceIdSchema,
  isInvoiceCurrencyPayable,
  type ManualInvoiceInput,
  ManualInvoiceValidationError,
  manualInvoiceInputSchema,
  type NormalizedManualInvoiceInput,
  normalizeManualInvoiceInput,
} from "@/features/accounting/manual-invoice";
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

export class ManualInvoiceConflictError extends Data.TaggedError(
  "ManualInvoiceConflictError"
)<{
  readonly invoiceId: string;
  readonly message: string;
}> {}

export interface Invoice {
  readonly id: string;
  readonly workspaceReservationId: string | null;
  readonly paymentAttemptId: string | null;
  readonly dotyposCustomerId: string;
  readonly invoiceNumber: InvoiceNumber;
  readonly issuedAt: Temporal.Instant;
  readonly document: InvoiceDocument;
}

export type InvoiceDeliveryStatus =
  | "missing"
  | "processing"
  | "accepted"
  | "failed";

export interface InvoiceListItem {
  readonly invoice: Invoice;
  readonly delivery: Readonly<
    Record<"customer" | "internal", InvoiceDeliveryStatus>
  >;
  readonly needsAttention: boolean;
}

export interface InvoiceIssuance {
  readonly invoice: Invoice;
  readonly changed: boolean;
}

export interface ReservationInvoice extends Invoice {
  readonly workspaceReservationId: string;
  readonly paymentAttemptId: string;
  readonly document: Exclude<InvoiceDocument, ManualInvoiceDocument>;
}

export interface ReservationInvoiceIssuance extends InvoiceIssuance {
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
  readonly issueManual: (
    input: ManualInvoiceInput
  ) => Effect.Effect<ManualInvoiceIssuance, InvoiceRepositoryError>;
  readonly list: () => Effect.Effect<
    readonly InvoiceListItem[],
    EffectDrizzleQueryError | InvoiceStorageError
  >;
  readonly getSuggestedVariableSymbol: () => Effect.Effect<
    string,
    EffectDrizzleQueryError
  >;
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
            id: row.id,
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

        const outcome = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const [locked] = yield* tx
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

            const [existing] = yield* tx
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

            yield* tx
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
        rawInput: ManualInvoiceInput
      ) {
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

        const outcome = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${normalized.invoiceId}))`
            );
            const [existing] = yield* tx
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
            yield* tx
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

      const list = Effect.fn("InvoiceRepository.list")(function* () {
        const rows = yield* db
          .select({
            invoiceId: invoices.id,
            audience: invoiceEmailDeliveries.audience,
            state: invoiceEmailDeliveries.state,
            updatedAt: invoiceEmailDeliveries.updatedAt,
          })
          .from(invoices)
          .leftJoin(
            invoiceEmailDeliveries,
            eq(invoiceEmailDeliveries.invoiceId, invoices.id)
          );
        const grouped = new Map<
          string,
          {
            customer: InvoiceDeliveryStatus;
            internal: InvoiceDeliveryStatus;
            stale: boolean;
          }
        >();
        const staleBefore = Temporal.Now.instant().subtract({ minutes: 1 });
        for (const row of rows) {
          const state = grouped.get(row.invoiceId) ?? {
            customer: "missing",
            internal: "missing",
            stale: false,
          };
          if (row.audience && row.state) state[row.audience] = row.state;
          if (
            row.state === "processing" &&
            row.updatedAt &&
            Temporal.Instant.compare(row.updatedAt, staleBefore) < 0
          ) {
            state.stale = true;
          }
          grouped.set(row.invoiceId, state);
        }

        // ponytail: decrypting the small invoice ledger in-process keeps one
        // repository path; add SQL pagination when the ledger is measurably large.
        const loaded = yield* Effect.all([...grouped.keys()].map(findById), {
          concurrency: "inherit",
        });
        return loaded.flatMap((invoice): InvoiceListItem[] => {
          if (!invoice) return [];
          const state = grouped.get(invoice.id)!;
          const delivery = {
            customer: state.customer,
            internal: state.internal,
          } as const;
          return [
            {
              invoice,
              delivery,
              needsAttention:
                state.stale ||
                delivery.customer === "missing" ||
                delivery.customer === "failed" ||
                delivery.internal === "missing" ||
                delivery.internal === "failed",
            },
          ];
        });
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
        findById,
        findByPaymentAttemptId,
        issue,
        issueManual,
        list,
        getSuggestedVariableSymbol,
      } satisfies IInvoiceRepository;
    })
  );
}

const wrapInvoiceEligibilityError = (
  paymentAttemptId: string,
  message: string
) => new InvoiceEligibilityError({ paymentAttemptId, message });

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
