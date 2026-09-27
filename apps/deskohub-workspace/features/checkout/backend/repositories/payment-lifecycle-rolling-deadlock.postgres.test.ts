import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { eq, inArray, sql } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import {
  accountingDocumentSnapshots,
  invoices,
  latePaymentRecoveries,
  orders,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import {
  type ILatePaymentRecoveryRepository,
  LatePaymentRecoveryRepository,
} from "@/features/checkout/backend/repositories/late-payment-recovery.repository";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
} from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";

mock.module("server-only", () => ({}) as never);

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

/**
 * Rolling-deployment mixed-version gate: the deployed old writers
 * (markPaid/markTerminal) update the payment_attempts row first and the
 * workspace_reservations row second. Every new attempt-mutating writer must
 * use the same attempt-first anchor so that old-new overlap serializes
 * instead of inverting into a PostgreSQL deadlock abort (a rejected write on
 * one side of the deploy).
 *
 * Connection A replays the exact old-writer shape (attempt row lock, latch,
 * reservation row lock). Connection B runs the new writer under test. The
 * overlap must complete on BOTH connections without a lock abort and leave
 * the correct persisted state and linkage behind.
 */

const personalAddress = {
  line1: "Synthetic 1",
  city: "Praha",
  postalCode: "100 00",
  country: "CZ",
};

const buyer = {
  kind: "person" as const,
  legalName: "Ada Lovelace",
  address: personalAddress,
};

/** A snapshot whose identity matches the fixture reservation. */
const makeSource = (identity: {
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly dotyposReservationId: string;
  readonly dotyposCustomerId: string;
}): AccountingDocumentSnapshot => {
  const document = makeCoworkInvoiceDocument("en-US");
  const {
    fulfilledAt: _fulfilledAt,
    invoiceNumber: _invoiceNumber,
    issuedAt: _issuedAt,
    paidAt: _paidAt,
    paymentAttemptId: _paymentAttemptId,
    supplier: invoiceSupplier,
    ...snapshotIdentity
  } = document;
  const { commercialRegister: _commercialRegister, ...supplier } =
    invoiceSupplier;

  return Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
    ...snapshotIdentity,
    supplier,
    ...identity,
    billing: {
      purpose: "personal",
      invoice: "requested",
      address: personalAddress,
    },
    delivery: { email: "synthetic@example.test" },
  });
};

describe.skipIf(!postgresDatabase)(
  "old-vs-new rolling-deploy lock order on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    const fixtureReservationIds: WorkspaceReservationId[] = [];

    const insertReservation = async (
      values: Partial<typeof workspaceReservations.$inferInsert> = {}
    ) => {
      const id = workspaceReservationIdSchema.make(crypto.randomUUID());
      await Effect.runPromise(
        postgres.db.insert(workspaceReservations).values({
          id,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `attempt-${crypto.randomUUID()}`
          ),
          dotyposCustomerId: DotyposCustomerIdSchema.make(
            `customer-${crypto.randomUUID()}`
          ),
          dotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-reservation-${crypto.randomUUID()}`
          ),
          reservationState: "held",
          paymentState: "not_started",
          fulfillmentState: "not_started",
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
          ...values,
        })
      );
      fixtureReservationIds.push(id);
      return id;
    };

    const insertOrderMirror = async (id: WorkspaceReservationId) => {
      const [reservation] = await Effect.runPromise(
        postgres.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
          .limit(1)
      );
      const values = {
        id,
        kind: "reservation" as const,
        correlationId: reservation!.correlationId,
        dotyposCustomerId: reservation!.dotyposCustomerId,
        paymentState: reservation!.paymentState,
        fulfillmentState: reservation!.fulfillmentState,
        activePaymentAttemptId: reservation!.activePaymentAttemptId,
        paidAt: reservation!.paidAt,
        fulfilledAt: reservation!.fulfilledAt,
        fulfillmentFailedAt: reservation!.fulfillmentFailedAt,
        fulfillmentFailureCode: reservation!.fulfillmentFailureCode,
        createdAt: reservation!.createdAt,
        updatedAt: reservation!.updatedAt,
      };
      await Effect.runPromise(
        postgres.db.insert(orders).values(values).onConflictDoUpdate({
          target: orders.id,
          set: values,
        })
      );
    };

    const insertAttempt = async (
      values: Partial<typeof paymentAttempts.$inferInsert> & {
        readonly workspaceReservationId: WorkspaceReservationId;
      }
    ) => {
      const [attempt] = await Effect.runPromise(
        postgres.db
          .insert(paymentAttempts)
          .values({
            orderId: values.workspaceReservationId as never,
            provider: "nexi",
            providerOrderId: `order-${crypto.randomUUID()}` as never,
            state: "pending",
            amountValue: 35_000,
            amountExponent: 2,
            currency: "CZK",
            ...values,
          })
          .returning()
      );
      return attempt!;
    };

    /**
     * Held-pending fixture shaped exactly like production before a webhook:
     * the order exists from the create path and the pending attempt is
     * already order-linked.
     */
    const insertHeldPendingFixture = async () => {
      const id = await insertReservation({
        reservationState: "held",
        paymentState: "pending",
      });
      await insertOrderMirror(id);
      const attempt = await insertAttempt({ workspaceReservationId: id });
      await Effect.runPromise(
        postgres.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: attempt.id })
          .where(eq(workspaceReservations.id, id))
      );
      return { id, attemptId: attempt.id };
    };

    /** Paid + fulfilled fixture that satisfies the invoice-eligibility gate. */
    const insertPaidFulfilledFixture = async () => {
      const id = workspaceReservationIdSchema.make(crypto.randomUUID());
      const attemptId = crypto.randomUUID();
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `customer-${crypto.randomUUID()}`
      );
      const dotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-reservation-${crypto.randomUUID()}`
      );
      const paidAt = Temporal.Now.instant();
      await Effect.runPromise(
        postgres.db.insert(workspaceReservations).values({
          id,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `attempt-${crypto.randomUUID()}`
          ),
          dotyposCustomerId,
          dotyposReservationId,
          reservationState: "held",
          paymentState: "paid",
          paidAt,
          fulfillmentState: "fulfilled",
          fulfilledAt: paidAt,
          activePaymentAttemptId: attemptId as never,
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
        })
      );
      fixtureReservationIds.push(id);
      await Effect.runPromise(
        postgres.db.insert(paymentAttempts).values({
          id: attemptId as never,
          workspaceReservationId: id,
          provider: "nexi",
          providerOrderId: `order-${crypto.randomUUID()}` as never,
          state: "paid",
          amountValue: 35_000,
          amountExponent: 2,
          currency: "CZK",
        })
      );
      await insertOrderMirror(id);
      // orders.active_payment_attempt_id → payment_attempts and
      // payment_attempts.order_id → orders form a cycle, so the linkage is
      // set after both rows exist, like the production writers do in-tx.
      await Effect.runPromise(
        postgres.db
          .update(paymentAttempts)
          .set({ orderId: id as never })
          .where(eq(paymentAttempts.id, attemptId as never))
      );
      const source = makeSource({
        workspaceReservationId: id,
        dotyposReservationId,
        dotyposCustomerId,
      });
      await Effect.runPromise(
        postgres.db.insert(accountingDocumentSnapshots).values({
          paymentAttemptId: attemptId as never,
          workspaceReservationId: id,
          keyId: "KEY_1",
          encryptedSnapshot:
            sql`pgp_sym_encrypt(${JSON.stringify(source)}, ${"synthetic-secret"}, ${"cipher-algo=aes256,compress-algo=1,unicode-mode=1"})` as never,
        })
      );
      return { id, attemptId };
    };

    /** Terminal-attempt fixture that satisfies recovery `start`. */
    const insertTerminalRecoveryFixture = async () => {
      const id = await insertReservation({
        reservationState: "held",
        paymentState: "failed",
      });
      await insertOrderMirror(id);
      const attempt = await insertAttempt({
        workspaceReservationId: id,
        state: "failed",
        failureCode: "provider_declined",
      });
      await Effect.runPromise(
        postgres.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: attempt.id })
          .where(eq(workspaceReservations.id, id))
      );
      return { id, attemptId: attempt.id };
    };

    const makeLifecycleRepository = async () =>
      (await Effect.runPromise(
        Effect.gen(function* () {
          return yield* PaymentLifecycleRepository;
        }).pipe(
          Effect.provide(
            PaymentLifecycleRepository.Default.pipe(
              Layer.provide(postgres.layer)
            )
          )
        )
      )) as IPaymentLifecycleRepository;

    const makeInvoiceRepository = () =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* InvoiceRepository;
        }).pipe(
          Effect.provide(
            InvoiceRepository.Default.pipe(
              Layer.provide(
                AccountingDocumentSnapshotRepository.Default.pipe(
                  Layer.provide(postgres.layer)
                )
              ),
              Layer.provide(
                Layer.succeed(
                  AccountingSnapshotKeyService,
                  AccountingSnapshotKeyService.of({
                    getActive: Effect.succeed({
                      id: "KEY_1" as never,
                      secret: "synthetic-secret",
                    }),
                    getById: () =>
                      Effect.succeed({
                        id: "KEY_1" as never,
                        secret: "synthetic-secret",
                      }),
                  } as never)
                )
              ),
              Layer.provide(postgres.layer)
            )
          )
        )
      );

    const makeRecoveryRepository = async () =>
      (await Effect.runPromise(
        Effect.gen(function* () {
          return yield* LatePaymentRecoveryRepository;
        }).pipe(
          Effect.provide(
            LatePaymentRecoveryRepository.Default.pipe(
              Layer.provide(postgres.layer)
            )
          )
        )
      )) as ILatePaymentRecoveryRepository;

    const waitUntilBlockedOnAttempts = async () => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const { rows } = await postgres.pool.query(
          `select 1 from pg_stat_activity
            where wait_event_type = 'Lock'
              and pid <> pg_backend_pid()
              and (
                query ilike '%update "payment_attempts"%'
                or query ilike '%from "payment_attempts"%'
              )
            limit 1`
        );
        if (rows.length > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    };

    /**
     * Connection A replays the deployed old-writer shape: it takes the
     * payment attempt row lock first, pauses, then takes the reservation row
     * lock. Connection B runs the new writer against the same rows. Both
     * sides must complete without a lock abort.
     */
    const runOldWriterOverlap = async <T>(options: {
      readonly attemptId: string;
      readonly reservationId: WorkspaceReservationId;
      readonly oldAttemptLock?: "update" | "for update";
      readonly writer: () => Promise<T>;
    }) => {
      const old = await postgres.pool.connect();
      let oldWriterError: unknown;
      let oldWriterUpdateCount: number | null = null;
      let writerError: unknown;
      let result: T;
      try {
        await old.query("begin");
        if (options.oldAttemptLock === "for update") {
          await old.query(
            "select id from payment_attempts where id = $1 for update",
            [options.attemptId]
          );
        } else {
          await old.query(
            "update payment_attempts set updated_at = updated_at where id = $1",
            [options.attemptId]
          );
        }

        const pending = options.writer();
        expect(await waitUntilBlockedOnAttempts()).toBe(true);

        try {
          const update = await old.query(
            "update workspace_reservations set updated_at = updated_at where id = $1",
            [options.reservationId]
          );
          oldWriterUpdateCount = update.rowCount;
        } catch (cause) {
          oldWriterError = cause;
        }

        await old.query("commit");
        result = await pending;
      } catch (cause) {
        writerError = cause;
        throw writerError;
      } finally {
        await old.query("rollback").catch(() => {});
        old.release();
      }
      return {
        result,
        oldWriterError,
        oldWriterUpdateCount,
        writerError,
      };
    };

    afterEach(async () => {
      if (fixtureReservationIds.length === 0) return;
      const ids = [...fixtureReservationIds];
      fixtureReservationIds.length = 0;
      // Issued invoices and stored snapshots are production-immutable via
      // triggers; both triggers are lifted only for this disposable-database
      // cleanup.
      await postgres.pool.query(
        "drop trigger if exists invoices_immutable on invoices"
      );
      await postgres.pool.query(
        "drop trigger if exists accounting_document_snapshots_immutable on accounting_document_snapshots"
      );
      try {
        await Effect.runPromise(
          postgres.db
            .delete(invoices)
            .where(inArray(invoices.workspaceReservationId, ids as never))
        );
        await Effect.runPromise(
          postgres.db
            .delete(accountingDocumentSnapshots)
            .where(
              inArray(
                accountingDocumentSnapshots.workspaceReservationId,
                ids as never
              )
            )
        );
        await Effect.runPromise(
          postgres.db
            .delete(latePaymentRecoveries)
            .where(
              inArray(
                latePaymentRecoveries.workspaceReservationId,
                ids as never
              )
            )
        );
        await Effect.runPromise(
          postgres.db
            .delete(orders)
            .where(inArray(orders.id, ids as readonly string[]))
        );
        await Effect.runPromise(
          postgres.db
            .delete(paymentAttempts)
            .where(
              inArray(paymentAttempts.workspaceReservationId, ids as never)
            )
        );
        await Effect.runPromise(
          postgres.db
            .delete(workspaceReservations)
            .where(inArray(workspaceReservations.id, ids))
        );
      } finally {
        await postgres.pool.query(
          "create trigger invoices_immutable before update or delete on invoices for each row execute function reject_invoice_mutation()"
        );
        await postgres.pool.query(
          "create trigger accounting_document_snapshots_immutable before update or delete on accounting_document_snapshots for each row execute function reject_accounting_document_snapshot_mutation()"
        );
      }
    });

    test("old markPaid overlap completes new markPaid without a lock abort", async () => {
      const { id, attemptId } = await insertHeldPendingFixture();
      const lifecycle = await makeLifecycleRepository();

      const run = await runOldWriterOverlap({
        attemptId,
        reservationId: id,
        writer: () =>
          Effect.runPromise(
            lifecycle.markPaid({
              id: attemptId as never,
              workspaceReservationId: id,
              providerStatus: "APPROVED",
              paidAt: Temporal.Now.instant(),
            })
          ),
      });

      // Neither side of the deploy may see a rejected write.
      expect(run.writerError).toBeUndefined();
      expect(run.oldWriterError).toBeUndefined();
      expect(run.oldWriterUpdateCount).toBe(1);

      const transition = run.result;
      expect(transition.changed).toBe(true);
      expect(transition.attempt.state).toBe("paid");

      const [reservation] = await Effect.runPromise(
        postgres.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
          .limit(1)
      );
      expect(reservation!.paymentState).toBe("paid");
      expect(reservation!.paidAt).not.toBeNull();

      const [attempt] = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, attemptId as never))
          .limit(1)
      );
      expect(attempt!.state).toBe("paid");
      expect(attempt!.orderId).toBe(id);

      const [order] = await Effect.runPromise(
        postgres.db.select().from(orders).where(eq(orders.id, id)).limit(1)
      );
      expect(order!.paymentState).toBe("paid");
      expect(order!.paidAt).not.toBeNull();
    });

    test("old recovery FOR UPDATE overlap completes new invoice issue without a lock abort", async () => {
      const { id, attemptId } = await insertPaidFulfilledFixture();
      const invoiceRepository = await makeInvoiceRepository();

      const run = await runOldWriterOverlap({
        attemptId,
        reservationId: id,
        oldAttemptLock: "for update",
        writer: () =>
          Effect.runPromise(
            invoiceRepository.issue({
              paymentAttemptId: attemptId,
              buyer,
            }) as never
          ) as Promise<{
            changed: boolean;
            invoice: { paymentAttemptId: string };
          }>,
      });

      expect(run.writerError).toBeUndefined();
      expect(run.oldWriterError).toBeUndefined();
      expect(run.oldWriterUpdateCount).toBe(1);

      const issuance = run.result;
      expect(issuance.changed).toBe(true);
      expect(issuance.invoice.paymentAttemptId).toBe(attemptId);

      const [issuedInvoice] = await Effect.runPromise(
        postgres.db
          .select()
          .from(invoices)
          .where(eq(invoices.paymentAttemptId, attemptId as never))
          .limit(1)
      );
      expect(issuedInvoice!.workspaceReservationId).toBe(id);
    });

    test("old-shaped recovery overlap completes new recovery start without a lock abort", async () => {
      const { id, attemptId } = await insertTerminalRecoveryFixture();
      const recovery = await makeRecoveryRepository();

      const run = await runOldWriterOverlap({
        attemptId,
        reservationId: id,
        writer: () =>
          Effect.runPromise(
            recovery.start({
              paymentAttemptId: attemptId as never,
              workspaceReservationId: id,
              webhookEventId: `event-${crypto.randomUUID()}` as never,
              providerStatus: "APPROVED",
              verifiedPaidAt: Temporal.Now.instant(),
            })
          ),
      });

      expect(run.writerError).toBeUndefined();
      expect(run.oldWriterError).toBeUndefined();
      expect(run.oldWriterUpdateCount).toBe(1);

      const started = run.result;
      expect(started.state).toBe("pending");

      const [recoveryRow] = await Effect.runPromise(
        postgres.db
          .select()
          .from(latePaymentRecoveries)
          .where(eq(latePaymentRecoveries.paymentAttemptId, attemptId as never))
          .limit(1)
      );
      expect(recoveryRow!.state).toBe("pending");

      // The recovery path persisted the attempt → order linkage too.
      const [attempt] = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, attemptId as never))
          .limit(1)
      );
      expect(attempt!.orderId).toBe(id);
    });
  }
);
