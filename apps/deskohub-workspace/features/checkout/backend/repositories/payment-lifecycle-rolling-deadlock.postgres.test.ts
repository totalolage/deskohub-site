import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { inspect } from "node:util";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { eq, inArray, sql } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import {
  accountingDocumentSnapshots,
  discountApplications,
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
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
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

/** An internal-payment source snapshot whose full payable amount is discounted. */
const makeZeroTotalSource = (identity: {
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly dotyposReservationId: string;
  readonly dotyposCustomerId: string;
}) => {
  const source = makeSource(identity);
  const firstItem = source.quote.items[0]!;
  const subtotal = {
    value: source.quote.items.reduce(
      (total, item) => total + item.amount.value,
      0
    ),
    exponent: firstItem.amount.exponent,
    currency: firstItem.amount.currency,
  };
  const zero = {
    value: 0,
    exponent: subtotal.exponent,
    currency: subtotal.currency,
  };
  const discount = {
    discount: {
      id: discountIdSchema.make("rolling-internal-zero-discount"),
      label: "Zero total",
      adjustment: { kind: "percentage" as const, basisPoints: 10_000 },
    },
    subtotalBefore: subtotal,
    amount: subtotal,
    subtotalAfter: zero,
  };
  const snapshot = Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
    ...source,
    quote: {
      ...source.quote,
      payment: {
        ...source.quote.payment,
        expectedPrice: zero,
        discounts: [discount],
      },
    },
  });

  return {
    amount: zero,
    snapshot,
    commitment: makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      applications: [
        {
          application: snapshot.quote.payment.discounts[0]!,
          candidate: {
            provenance: {
              providerNamespace: "test",
              providerReference: "rolling-internal-zero",
            },
          },
        },
      ],
    }),
  };
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
      },
      options: { readonly orderless?: boolean } = {}
    ) => {
      const [attempt] = await Effect.runPromise(
        postgres.db
          .insert(paymentAttempts)
          .values({
            ...(!options.orderless && {
              orderId: values.workspaceReservationId as never,
            }),
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
      // The order's active attempt is a scalar mirror; payment_attempts.order_id
      // retains its FK, so create the order before persisting that attempt link.
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

    /** Old post-backfill writer shape: terminal attempt, active pointer, no Order. */
    const insertLegacyTerminalWithoutOrder = async () => {
      const id = await insertReservation({
        reservationState: "held",
        paymentState: "failed",
        failureCode: "provider_declined",
        reservationHoldExpiresAt: Temporal.Instant.from("2099-01-01T00:00:00Z"),
      });
      const [reservation] = await Effect.runPromise(
        postgres.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
          .limit(1)
      );
      const attempt = await insertAttempt(
        {
          workspaceReservationId: id,
          orderId: null,
          state: "failed",
          failureCode: "provider_declined",
        },
        { orderless: true }
      );
      await Effect.runPromise(
        postgres.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: attempt.id })
          .where(eq(workspaceReservations.id, id))
      );
      return {
        id,
        attemptId: attempt.id,
        dotyposCustomerId: reservation!.dotyposCustomerId,
        dotyposReservationId: reservation!.dotyposReservationId!,
      };
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

    const waitUntilBlockedOnOrderInsert = async () => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const { rows } = await postgres.pool.query(
          `select 1 from pg_stat_activity
            where wait_event_type = 'Lock'
              and pid <> pg_backend_pid()
              and query ilike '%insert into "orders"%'
            limit 1`
        );
        if (rows.length > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    };

    const waitUntilBlockedOnReservation = async () => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const { rows } = await postgres.pool.query(
          `select 1 from pg_stat_activity
            where wait_event_type = 'Lock'
              and pid <> pg_backend_pid()
              and query ilike '%from workspace_reservations%'
              and query ilike '%for update%'
            limit 1`
        );
        if (rows.length > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    };

    const runOldRecoveryStartOverlap = async <T>(input: {
      readonly attemptId: string;
      readonly reservationId: WorkspaceReservationId;
      readonly writer: () => Promise<T>;
    }) => {
      const old = await postgres.pool.connect();
      const latch = await postgres.pool.connect();
      let writer: Promise<T> | undefined;
      let recoveryStart: Promise<void> | undefined;
      let orderInsertBlocked = false;
      let reservationBlocked = false;
      let oldResult: PromiseSettledResult<void> | undefined;
      let writerResult: PromiseSettledResult<T> | undefined;
      try {
        await postgres.pool.query(`
          create or replace function workspace_test_pause_recovery_order_mirror()
          returns trigger language plpgsql as $$
          begin
            perform pg_advisory_xact_lock(hashtext(new.id), 247385);
            return new;
          end;
          $$
        `);
        await postgres.pool.query(
          "drop trigger if exists workspace_test_pause_recovery_order_mirror on orders"
        );
        await postgres.pool.query(`
          create trigger workspace_test_pause_recovery_order_mirror
          before insert or update on orders
          for each row execute function workspace_test_pause_recovery_order_mirror()
        `);
        await latch.query("select pg_advisory_lock(hashtext($1), 247385)", [
          input.reservationId,
        ]);
        await old.query("begin");
        await old.query(
          "select id from payment_attempts where id = $1 for update",
          [input.attemptId]
        );

        writer = input.writer();
        orderInsertBlocked = await waitUntilBlockedOnOrderInsert();
        recoveryStart = (async () => {
          const [reservation] = (
            await old.query(
              "select dotypos_reservation_id from workspace_reservations where id = $1 for update",
              [input.reservationId]
            )
          ).rows;
          await old.query(
            `insert into late_payment_recoveries
               (payment_attempt_id, workspace_reservation_id, webhook_event_id,
                provider_status, state, original_dotypos_reservation_id,
                verified_paid_at)
             values ($1, $2, $3, 'APPROVED', 'pending', $4, now())`,
            [
              input.attemptId,
              input.reservationId,
              `event-${crypto.randomUUID()}`,
              reservation!.dotypos_reservation_id,
            ]
          );
          await old.query("commit");
        })();
        reservationBlocked = await waitUntilBlockedOnReservation();
        await latch.query("select pg_advisory_unlock(hashtext($1), 247385)", [
          input.reservationId,
        ]);
        [oldResult, writerResult] = await Promise.allSettled([
          recoveryStart!,
          writer!,
        ]);
      } finally {
        await latch
          .query("select pg_advisory_unlock(hashtext($1), 247385)", [
            input.reservationId,
          ])
          .catch(() => {});
        await Promise.allSettled(
          [recoveryStart, writer].filter(
            (promise): promise is Promise<unknown> => promise !== undefined
          )
        );
        await old.query("rollback").catch(() => {});
        old.release();
        latch.release();
        await postgres.pool.query(
          "drop trigger if exists workspace_test_pause_recovery_order_mirror on orders"
        );
        await postgres.pool.query(
          "drop function if exists workspace_test_pause_recovery_order_mirror()"
        );
      }

      return {
        oldResult: oldResult!,
        writerResult: writerResult!,
        orderInsertBlocked,
        reservationBlocked,
      };
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
            .delete(discountApplications)
            .where(
              inArray(discountApplications.workspaceReservationId, ids as never)
            )
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
            .delete(orders)
            .where(inArray(orders.id, ids as readonly string[]))
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

    test("old recovery FOR UPDATE start overlaps external retry with a missing order", async () => {
      const fixture = await insertLegacyTerminalWithoutOrder();
      const lifecycle = await makeLifecycleRepository();
      const snapshot = makeSource({
        workspaceReservationId: fixture.id,
        dotyposReservationId: fixture.dotyposReservationId,
        dotyposCustomerId: fixture.dotyposCustomerId,
      });
      expect(snapshot.workspaceReservationId).toBe(fixture.id);
      expect(snapshot.locale).toBe("en-US");
      expect(
        snapshot.quote.items.reduce(
          (total, item) => total + item.amount.value,
          0
        )
      ).toBe(snapshot.quote.payment.undiscountedPrice.value);
      expect(
        snapshot.quote.items.reduce(
          (total, item) => total + item.amount.value,
          0
        ) -
          snapshot.quote.payment.discounts.reduce(
            (total, discount) => total + discount.amount.value,
            0
          )
      ).toBe(snapshot.quote.payment.expectedPrice.value);
      const run = await runOldRecoveryStartOverlap({
        attemptId: fixture.attemptId,
        reservationId: fixture.id,
        writer: () =>
          Effect.runPromise(
            lifecycle.createPendingNexiAttempt({
              workspaceReservationId: fixture.id,
              providerOrderId: NexiOrderIdSchema.make(
                `retry-${crypto.randomUUID()}`
              ),
              amount: snapshot.quote.payment.expectedPrice,
              commitment: makeDiscountCommitment({
                product: { kind: "cowork", tier: "basic" },
                applications: [],
              }),
              locale: "en-US",
              accountingSnapshot: snapshot,
            })
          ),
      });

      expect(run.orderInsertBlocked).toBe(true);
      expect(run.reservationBlocked).toBe(true);
      expect(run.oldResult.status).toBe("fulfilled");
      expect(run.writerResult.status).toBe("fulfilled");
      if (run.writerResult.status !== "fulfilled") return;

      const newAttempt = run.writerResult.value;
      expect(newAttempt.state).toBe("created");
      expect(newAttempt.orderId).toBe(fixture.id);

      const [reservation] = await Effect.runPromise(
        postgres.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, fixture.id))
          .limit(1)
      );
      const [order] = await Effect.runPromise(
        postgres.db
          .select()
          .from(orders)
          .where(eq(orders.id, fixture.id))
          .limit(1)
      );
      const attempts = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.workspaceReservationId, fixture.id))
      );
      const [recovery] = await Effect.runPromise(
        postgres.db
          .select()
          .from(latePaymentRecoveries)
          .where(
            eq(
              latePaymentRecoveries.paymentAttemptId,
              fixture.attemptId as never
            )
          )
          .limit(1)
      );

      expect(reservation!.paymentState).toBe("pending");
      expect(reservation!.activePaymentAttemptId).toBe(newAttempt.id);
      expect(order!.paymentState).toBe(reservation!.paymentState);
      expect(order!.activePaymentAttemptId).toBe(newAttempt.id);
      expect(attempts).toHaveLength(2);
      expect(attempts.find(({ id }) => id === fixture.attemptId)?.state).toBe(
        "failed"
      );
      expect(
        attempts.find(({ id }) => id === fixture.attemptId)?.orderId
      ).toBeNull();
      expect(recovery!.state).toBe("pending");
    });

    test("old recovery FOR UPDATE start overlaps zero-total replacement of a failed attempt", async () => {
      const fixture = await insertLegacyTerminalWithoutOrder();
      const lifecycle = await makeLifecycleRepository();
      const checkout = makeZeroTotalSource({
        workspaceReservationId: fixture.id,
        dotyposReservationId: fixture.dotyposReservationId,
        dotyposCustomerId: fixture.dotyposCustomerId,
      });
      const run = await runOldRecoveryStartOverlap({
        attemptId: fixture.attemptId,
        reservationId: fixture.id,
        writer: () =>
          Effect.runPromise(
            lifecycle.completeInternalPayment({
              workspaceReservationId: fixture.id,
              amount: checkout.amount,
              commitment: checkout.commitment,
              locale: "en-US",
              accountingSnapshot: checkout.snapshot,
            })
          ),
      });

      expect(run.orderInsertBlocked).toBe(true);
      expect(run.reservationBlocked).toBe(true);
      expect(run.oldResult.status).toBe("fulfilled");
      expect(run.writerResult.status).toBe("fulfilled");
      if (run.writerResult.status !== "fulfilled") return;

      const transition = run.writerResult.value;
      expect(transition.changed).toBe(true);
      expect(transition.attempt.provider).toBe("internal");
      expect(transition.attempt.state).toBe("paid");
      expect(transition.attempt.orderId).toBe(fixture.id);

      const [reservation] = await Effect.runPromise(
        postgres.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, fixture.id))
          .limit(1)
      );
      const [order] = await Effect.runPromise(
        postgres.db
          .select()
          .from(orders)
          .where(eq(orders.id, fixture.id))
          .limit(1)
      );
      const attempts = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.workspaceReservationId, fixture.id))
      );
      const [recovery] = await Effect.runPromise(
        postgres.db
          .select()
          .from(latePaymentRecoveries)
          .where(
            eq(
              latePaymentRecoveries.paymentAttemptId,
              fixture.attemptId as never
            )
          )
          .limit(1)
      );

      expect(reservation!.paymentState).toBe("paid");
      expect(reservation!.activePaymentAttemptId).toBe(transition.attempt.id);
      expect(reservation!.fulfilledAt).toBeNull();
      expect(order!.paymentState).toBe("paid");
      expect(order!.activePaymentAttemptId).toBe(transition.attempt.id);
      expect(order!.fulfilledAt).toBeNull();
      expect(attempts).toHaveLength(2);
      expect(attempts.find(({ id }) => id === fixture.attemptId)?.state).toBe(
        "failed"
      );
      expect(
        attempts.find(({ id }) => id === transition.attempt.id)
      ).toMatchObject({
        provider: "internal",
        state: "paid",
        orderId: fixture.id,
        amountValue: 0,
        currency: checkout.amount.currency,
      });
      expect(recovery!.state).toBe("pending");
    });

    test("matching-terminal replay waits on the recovery row instead of deadlocking old settlement", async () => {
      const fixture = await insertLegacyTerminalWithoutOrder();
      const lifecycle = await makeLifecycleRepository();
      const verifiedPaidAt = Temporal.Now.instant();
      await Effect.runPromise(
        postgres.db.insert(latePaymentRecoveries).values({
          paymentAttemptId: fixture.attemptId as never,
          workspaceReservationId: fixture.id,
          webhookEventId: `event-${crypto.randomUUID()}` as never,
          providerStatus: "APPROVED",
          state: "processing",
          originalDotyposReservationId: fixture.dotyposReservationId,
          verifiedPaidAt,
          claimedAt: verifiedPaidAt,
        })
      );

      const old = await postgres.pool.connect();
      let replay: Promise<unknown> | undefined;
      try {
        // Deployed old settlement: recovery row → reservation, paused before
        // its attempt FOR UPDATE.
        await old.query("begin");
        await old.query(
          "select payment_attempt_id from late_payment_recoveries where payment_attempt_id = $1 for update",
          [fixture.attemptId]
        );
        await old.query(
          "select id from workspace_reservations where id = $1 for update",
          [fixture.id]
        );

        replay = Effect.runPromise(
          lifecycle.markTerminal({
            id: fixture.attemptId as never,
            workspaceReservationId: fixture.id,
            state: "failed",
            failureCode: "provider_declined",
          })
        );

        // The replay must block on its first lock (recovery row when fixed,
        // reservation when not) before this probe runs.
        const deadline = Date.now() + 5_000;
        let replayBlocked = false;
        while (Date.now() < deadline) {
          const { rows } = await postgres.pool.query(
            `select 1 from pg_stat_activity
              where pid <> pg_backend_pid()
                and wait_event_type = 'Lock'
                and (
                  query ilike '%from "late_payment_recoveries"%'
                  or (query ilike '%from "workspace_reservations"%'
                      and query ilike '%for update%')
                )
              limit 1`
          );
          if (rows.length > 0) {
            replayBlocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(replayBlocked).toBe(true);

        // The replay must not own the attempt row while old settlement still
        // needs it: this nowait probe succeeds only when the replay anchored
        // on the recovery row first.
        const attemptProbe = await postgres.pool.query(
          "select 1 from payment_attempts where id = $1 for update nowait",
          [fixture.attemptId]
        );
        expect(attemptProbe.rowCount).toBe(1);

        // Old settlement completes its attempt → reservation work.
        await old.query(
          "select id from payment_attempts where id = $1 for update",
          [fixture.attemptId]
        );
        await old.query(
          "update payment_attempts set state = 'paid', failure_code = null, updated_at = $2 where id = $1",
          [fixture.attemptId, verifiedPaidAt]
        );
        await old.query(
          "update workspace_reservations set payment_state = 'paid', paid_at = $2, failure_code = null, updated_at = $2 where id = $1",
          [fixture.id, verifiedPaidAt]
        );
        await old.query(
          `update late_payment_recoveries
              set state = 'recovered',
                  recovered_dotypos_reservation_id = original_dotypos_reservation_id,
                  completed_at = $2,
                  updated_at = $2
            where payment_attempt_id = $1`,
          [fixture.attemptId, verifiedPaidAt]
        );
        await old.query("commit");

        // The replay can no longer terminal a paid attempt; it must fail its
        // state guard instead of the whole settlement deadlocking.
        console.error("CHK awaiting-replay", Date.now());
        const [replayResult] = await Promise.allSettled([replay]);
        console.error("CHK replay", replayResult.status, Date.now());
        expect(replayResult.status).toBe("rejected");
      } finally {
        await old.query("rollback").catch(() => {});
        old.release();
        if (replay) await Promise.allSettled([replay]);
      }

      const [reservation] = await Effect.runPromise(
        postgres.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, fixture.id))
          .limit(1)
      );
      const [attempt] = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, fixture.attemptId as never))
          .limit(1)
      );
      const [recovery] = await Effect.runPromise(
        postgres.db
          .select()
          .from(latePaymentRecoveries)
          .where(
            eq(
              latePaymentRecoveries.paymentAttemptId,
              fixture.attemptId as never
            )
          )
          .limit(1)
      );
      expect(reservation!.paymentState).toBe("paid");
      expect(reservation!.paidAt).not.toBeNull();
      expect(attempt!.state).toBe("paid");
      expect(recovery!.state).toBe("recovered");
    });

    test("terminal replay retries when a recovery row appears before its attempt lock", async () => {
      const fixture = await insertLegacyTerminalWithoutOrder();
      const lifecycle = await makeLifecycleRepository();
      const verifiedPaidAt = Temporal.Now.instant();

      // An EXCLUSIVE table lock parks the replay's attempt UPDATE at
      // statement start — before any row lock and before the recheck —
      // widening the anchor-to-attempt-lock window so the race is
      // deterministic. EXCLUSIVE (not SHARE) also keeps old settlement's
      // attempt FOR UPDATE queued behind the replay, mirroring production
      // where the replay's UPDATE wins the tuple before the paused
      // settlement resumes. A plain lock cannot pause a statement, so the
      // anchor really has run with no recovery row visible.
      const gate = await postgres.pool.connect();
      const old = await postgres.pool.connect();
      let replay: Promise<unknown> | undefined;
      let settlementError: unknown;
      try {
        await gate.query("begin");
        await gate.query("lock table payment_attempts in exclusive mode");

        replay = Effect.runPromise(
          lifecycle.markTerminal({
            id: fixture.attemptId as never,
            workspaceReservationId: fixture.id,
            state: "failed",
            failureCode: "provider_declined_late_probe",
            // Distinct webhook metadata: if the retried iteration-1
            // transaction committed instead of rolling back, these fields
            // would persist on the attempt even though old settlement never
            // writes them.
            webhookEventId: `event-late-probe-${crypto.randomUUID()}` as never,
            providerStatus: "FAILED_LATE_PROBE",
          })
        );

        const updateDeadline = Date.now() + 5_000;
        let replayParked = false;
        while (Date.now() < updateDeadline) {
          const { rows } = await postgres.pool.query(
            `select 1 from pg_stat_activity
              where pid <> pg_backend_pid()
                and wait_event_type = 'Lock'
                and query ilike 'update "payment_attempts"%'
              limit 1`
          );
          if (rows.length > 0) {
            replayParked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(replayParked).toBe(true);

        // The replay's empty anchor lookup has committed its snapshot. A
        // recovery start now publishes and claims its row (the committed
        // effect of start on this attempt), entirely inside the widened
        // window. The row is committed by a separate connection because a
        // table lock that parks the replay's UPDATE necessarily also parks
        // start's own relink UPDATE; the real start() path is exercised end
        // to end in the late-payment-recovery suites. The FK check is
        // skipped on this session so the insert does not need a KEY SHARE
        // on the exclusively locked payment_attempts row, and the role
        // switch is transaction-scoped (SET LOCAL) so the pooled connection
        // is restored — triggers and FK enforcement included — at commit.
        const publisher = await postgres.pool.connect();
        try {
          await publisher.query("begin");
          await publisher.query("set local session_replication_role = replica");
          await publisher.query(
            `insert into late_payment_recoveries
               (payment_attempt_id, workspace_reservation_id, webhook_event_id,
                provider_status, state, original_dotypos_reservation_id,
                verified_paid_at, claimed_at)
             values ($1, $2, $3, 'APPROVED', 'processing', $4, $5, $5)`,
            [
              fixture.attemptId,
              fixture.id,
              `event-${crypto.randomUUID()}`,
              fixture.dotyposReservationId,
              verifiedPaidAt.toString(),
            ]
          );
          await publisher.query("commit");
        } catch (cause) {
          await publisher.query("rollback").catch(() => {});
          throw cause;
        } finally {
          publisher.release();
        }

        // Deployed old settlement: recovery row → reservation, paused
        // before its attempt FOR UPDATE.
        await old.query("begin");
        await old.query(
          "select payment_attempt_id from late_payment_recoveries where payment_attempt_id = $1 for update",
          [fixture.attemptId]
        );
        await old.query(
          "select id from workspace_reservations where id = $1 for update",
          [fixture.id]
        );

        // Resume the replay. Fixed code: the attempt UPDATE matches, the
        // recheck sees the committed recovery row, the transaction retries,
        // and the second anchor waits on old settlement's recovery-row
        // lock. Unfixed code: the replay keeps the attempt tuple and waits
        // for the reservation old settlement holds — a deadlock old
        // settlement's attempt lock then completes. Wait for whichever
        // parked wait appears so the next statement is issued only after
        // the replay has committed to its path.
        await gate.query("commit");

        const parkedDeadline = Date.now() + 5_000;
        let replayParkedOnLock = false;
        while (Date.now() < parkedDeadline) {
          const { rows } = await postgres.pool.query(
            `select 1 from pg_stat_activity
              where pid <> pg_backend_pid()
                and wait_event_type = 'Lock'
                and (
                  query ilike 'update "payment_attempts"%'
                  or query ilike '%from "workspace_reservations"%for update%'
                  or query ilike '%from "late_payment_recoveries"%'
                )
              limit 1`
          );
          if (rows.length > 0) {
            replayParkedOnLock = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(replayParkedOnLock).toBe(true);

        try {
          await old.query(
            "select id from payment_attempts where id = $1 for update",
            [fixture.attemptId]
          );
          await old.query(
            "update payment_attempts set state = 'paid', failure_code = null, updated_at = $2 where id = $1",
            [fixture.attemptId, verifiedPaidAt]
          );
          await old.query(
            "update workspace_reservations set payment_state = 'paid', paid_at = $2, failure_code = null, updated_at = $2 where id = $1",
            [fixture.id, verifiedPaidAt]
          );
          await old.query(
            `update late_payment_recoveries
                set state = 'recovered',
                    recovered_dotypos_reservation_id = original_dotypos_reservation_id,
                    completed_at = $2,
                    updated_at = $2
              where payment_attempt_id = $1`,
            [fixture.attemptId, verifiedPaidAt]
          );
          await old.query("commit");
        } catch (cause) {
          settlementError = cause;
        }

        const [replayResult] = await Promise.allSettled([replay]);
        // Neither side of the deploy may lose its write to a deadlock abort.
        expect(settlementError).toBeUndefined();
        const renderedSettlement =
          settlementError === undefined
            ? ""
            : inspect(settlementError, { depth: 8 });
        expect(/40P01|deadlock/i.test(renderedSettlement)).toBe(false);

        // The settled paid attempt refuses the terminal replay through its
        // state guard.
        expect(replayResult.status).toBe("rejected");
        if (replayResult.status === "rejected") {
          const rendered = inspect(replayResult.reason, { depth: 8 });
          expect(/40P01|deadlock/i.test(rendered)).toBe(false);
          expect(rendered).toContain("non-terminal");
        }
      } finally {
        await gate.query("rollback").catch(() => {});
        await old.query("rollback").catch(() => {});
        old.release();
        gate.release();
        if (replay) await Promise.allSettled([replay]);
      }

      const [reservation] = await Effect.runPromise(
        postgres.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, fixture.id))
          .limit(1)
      );
      const [attempt] = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, fixture.attemptId as never))
          .limit(1)
      );
      const [recoveryRow] = await Effect.runPromise(
        postgres.db
          .select()
          .from(latePaymentRecoveries)
          .where(
            eq(
              latePaymentRecoveries.paymentAttemptId,
              fixture.attemptId as never
            )
          )
          .limit(1)
      );
      expect(reservation!.paymentState).toBe("paid");
      expect(reservation!.paidAt).not.toBeNull();
      expect(attempt!.state).toBe("paid");
      expect(recoveryRow!.state).toBe("recovered");
      // No-committed-mutation proof: the retried iteration rolled back, so
      // the replay's distinct webhook metadata never reached the row (old
      // settlement's paid update does not write these fields).
      expect(attempt!.lastProviderStatus).toBeNull();
      expect(attempt!.lastWebhookEventId).toBeNull();
    }, 30_000);
  }
);
