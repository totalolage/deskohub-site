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
  orders,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
} from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { InvoiceRepository } from "./invoice.repository";

mock.module("server-only", () => ({}) as never);

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

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
  "InvoiceRepository.issue vs markPaid replay on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    const fixtureReservationIds: WorkspaceReservationId[] = [];

    /** Fixture with a real accounting snapshot row for the paid attempt. */
    const insertPaidFulfilledReservation = async (
      input: {
        readonly fulfillmentState?: "awaiting_delivery" | "fulfilled";
      } = {}
    ) => {
      const id = workspaceReservationIdSchema.make(crypto.randomUUID());
      const attemptId = crypto.randomUUID();
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `customer-${crypto.randomUUID()}`
      );
      const dotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-reservation-${crypto.randomUUID()}`
      );
      const fulfillmentState = input.fulfillmentState ?? "fulfilled";
      const customerEmailDeliveryId =
        `delivery-${crypto.randomUUID()}` as never;
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
          fulfillmentState,
          activeCustomerEmailDeliveryId:
            fulfillmentState === "awaiting_delivery"
              ? customerEmailDeliveryId
              : null,
          fulfilledAt: fulfillmentState === "fulfilled" ? paidAt : null,
          activePaymentAttemptId: attemptId as never,
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
        })
      );
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
      fixtureReservationIds.push(id);
      const source = makeSource({
        workspaceReservationId: id,
        dotyposReservationId,
        dotyposCustomerId,
      });
      // The invoice's attempt reference points at the snapshot row, so the
      // fixture stores one encrypted with the mocked active key's secret.
      await Effect.runPromise(
        postgres.db.insert(accountingDocumentSnapshots).values({
          paymentAttemptId: attemptId as never,
          workspaceReservationId: id,
          keyId: "KEY_1",
          encryptedSnapshot:
            sql`pgp_sym_encrypt(${JSON.stringify(source)}, ${"synthetic-secret"}, ${"cipher-algo=aes256,compress-algo=1,unicode-mode=1"})` as never,
        })
      );
      return {
        id,
        attemptId,
        customerEmailDeliveryId,
        dotyposCustomerId,
        dotyposReservationId,
        source,
      };
    };

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

    afterEach(async () => {
      if (fixtureReservationIds.length === 0) return;
      const ids = [...fixtureReservationIds];
      fixtureReservationIds.length = 0;
      // Issued invoices and stored snapshots are production-immutable via
      // triggers, so both triggers are lifted only for this
      // disposable-database cleanup, as with the dropped kind check in the
      // reservation-order suite. The order mirror references the attempt and
      // the attempt cascade-deletes through order_id.
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

    test("completes issuance and already-paid replay without a lock-order abort", async () => {
      const fixture = await insertPaidFulfilledReservation();
      const repository = await makeInvoiceRepository();
      const lifecycle = await makeLifecycleRepository();

      // Connection A plays the markPaid replay's first step: it holds the
      // reservation row lock and pauses before the replay continues.
      // (Issuance itself holds the attempt row under the attempt-first
      // order, so the two writers serialize on the reservation.)
      const latch = await postgres.pool.connect();
      let issuance:
        | Promise<{
            changed: boolean;
            invoice: { paymentAttemptId: string; invoiceNumber: string };
          }>
        | undefined;
      try {
        await latch.query("begin");
        await latch.query(
          "update workspace_reservations set updated_at = updated_at where id = $1",
          [fixture.id]
        );

        // Issuance must anchor on the payment attempt row: it locks the
        // attempt first and only then waits on the reservation. Deterministic
        // regression for the attempt-first lock order shared with markPaid
        // and the deployed old writers.
        issuance = Effect.runPromise(
          repository.issue({
            paymentAttemptId: fixture.attemptId,
            buyer,
          }) as never
        ) as Promise<{
          changed: boolean;
          invoice: { paymentAttemptId: string; invoiceNumber: string };
        }>;

        const deadline = Date.now() + 5_000;
        let blocked = false;
        while (Date.now() < deadline) {
          const { rows } = await postgres.pool.query(
            `select 1 from pg_stat_activity
              where wait_event_type = 'Lock'
                and query ilike '%for update%' limit 1`
          );
          if (rows.length > 0) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(blocked).toBe(true);

        // While blocked on the reservation, issuance must already hold the
        // attempt row: an attempt-first writer owns it and this nowait probe
        // must fail. A reservation-first issuance would not hold it here and
        // would invert against attempt-first writers.
        await expect(
          postgres.pool.query(
            "select 1 from payment_attempts where id = $1 for update nowait",
            [fixture.attemptId]
          )
        ).rejects.toThrow();

        // Releasing the reservation lets the already-paid markPaid replay
        // race the resuming issuance; both must finish without an abort.
        await latch.query("commit");
      } finally {
        await latch.query("rollback").catch(() => {});
        latch.release();
      }

      const [issuanceResult, replayResult] = await Promise.all([
        issuance!,
        Effect.runPromise(
          lifecycle.markPaid({
            id: fixture.attemptId as never,
            workspaceReservationId: fixture.id,
            paidAt: Temporal.Now.instant(),
          })
        ),
      ]);
      expect(issuanceResult.changed).toBe(true);
      expect(issuanceResult.invoice.paymentAttemptId).toBe(fixture.attemptId);
      // The replay is the already-paid path: idempotent, nothing changed.
      expect(replayResult.changed).toBe(false);
      expect(replayResult.attempt.state).toBe("paid");

      const [reservation] = await Effect.runPromise(
        postgres.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, fixture.id))
          .limit(1)
      );
      expect(reservation!.paymentState).toBe("paid");
      expect(reservation!.paidAt).not.toBeNull();

      const [attempt] = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, fixture.attemptId as never))
          .limit(1)
      );
      expect(attempt!.state).toBe("paid");

      const [issuedInvoice] = await Effect.runPromise(
        postgres.db
          .select()
          .from(invoices)
          .where(eq(invoices.paymentAttemptId, fixture.attemptId as never))
          .limit(1)
      );
      expect(issuedInvoice!.workspaceReservationId).toBe(fixture.id);
    });

    test("keeps invoice issuance closed until the matching delivery completes", async () => {
      const fixture = await insertPaidFulfilledReservation({
        fulfillmentState: "awaiting_delivery",
      });
      const repository = await makeInvoiceRepository();
      const invoiceNumbersBefore = await postgres.pool.query(
        "select count(*)::int as count from invoice_number_counters"
      );

      const eligibilityError = await Effect.runPromise(
        Effect.flip(
          repository.issue({
            paymentAttemptId: fixture.attemptId,
            buyer,
          })
        )
      );
      expect(eligibilityError).toMatchObject({
        _tag: "InvoiceEligibilityError",
      });
      const invoicesBeforeDelivery = await postgres.pool.query(
        "select payment_attempt_id from invoices where workspace_reservation_id = $1",
        [fixture.id]
      );
      expect(invoicesBeforeDelivery.rows).toHaveLength(0);
      expect(
        (
          await postgres.pool.query(
            "select count(*)::int as count from invoice_number_counters"
          )
        ).rows[0]!.count
      ).toBe(invoiceNumbersBefore.rows[0]!.count);

      const reservations = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* WorkspaceReservationRepository;
        }).pipe(
          Effect.provide(
            WorkspaceReservationRepository.Default.pipe(
              Layer.provide(postgres.layer)
            )
          )
        )
      );
      const fulfilledAt = Temporal.Now.instant();
      await Effect.runPromise(
        reservations.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId: fixture.customerEmailDeliveryId,
          fulfilledAt,
        })
      );

      const [reservation] = await Effect.runPromise(
        postgres.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, fixture.id))
          .limit(1)
      );
      expect(reservation!.fulfillmentState).toBe("fulfilled");
      expect(
        reservation!.fulfilledAt?.toString({ smallestUnit: "microsecond" })
      ).toBe(fulfilledAt.toString({ smallestUnit: "microsecond" }));

      const issued = await Effect.runPromise(
        repository.issue({
          paymentAttemptId: fixture.attemptId,
          buyer,
        })
      );
      expect(issued.changed).toBe(true);
      expect(issued.invoice.workspaceReservationId).toBe(fixture.id);
    });

    test("invoice issuance and a reservation-only mirror serialize without an active-attempt FK", async () => {
      const fixture = await insertPaidFulfilledReservation();
      const repository = await makeInvoiceRepository();
      const reservations = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* WorkspaceReservationRepository;
        }).pipe(
          Effect.provide(
            WorkspaceReservationRepository.Default.pipe(
              Layer.provide(postgres.layer)
            )
          )
        )
      );

      await postgres.pool.query(`
        create or replace function workspace_test_pause_invoice_order_mirror()
        returns trigger language plpgsql as $$
        begin
          perform pg_advisory_xact_lock(hashtext(new.id), 247385);
          return new;
        end;
        $$
      `);
      await postgres.pool.query(`
        create trigger workspace_test_pause_invoice_order_mirror
        before insert or update on orders
        for each row execute function workspace_test_pause_invoice_order_mirror()
      `);

      const waitForLockWait = async (queryPattern: string) => {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          const { rows } = await postgres.pool.query(
            `select 1 from pg_stat_activity
              where pid <> pg_backend_pid()
                and wait_event_type = 'Lock'
                and query ilike $1
              limit 1`,
            [queryPattern]
          );
          if (rows.length > 0) return true;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return false;
      };

      const latch = await postgres.pool.connect();
      const pending: Promise<unknown>[] = [];
      try {
        await latch.query("select pg_advisory_lock(hashtext($1), 247385)", [
          fixture.id,
        ]);

        const mirrored = Effect.runPromise(
          reservations.updateReservationDetails({
            id: fixture.id,
            reservationDetails: {
              kind: "cowork",
              entryTier: "basic",
              coffee: true,
            },
            locale: "cs-CZ",
          })
        );
        pending.push(mirrored);
        expect(await waitForLockWait('%insert into "orders"%')).toBe(true);

        const issuance = Effect.runPromise(
          repository.issue({
            paymentAttemptId: fixture.attemptId,
            buyer,
          })
        );
        pending.push(issuance);
        expect(
          await waitForLockWait('%from "workspace_reservations"%for update%')
        ).toBe(true);

        await latch.query("select pg_advisory_unlock(hashtext($1), 247385)", [
          fixture.id,
        ]);
        const [details, issued] = await Promise.all([mirrored, issuance]);
        expect(details.locale).toBe("cs-CZ");
        expect(issued.changed).toBe(true);
      } finally {
        await latch
          .query("select pg_advisory_unlock(hashtext($1), 247385)", [
            fixture.id,
          ])
          .catch(() => {});
        await Promise.allSettled(pending);
        latch.release();
        await postgres.pool.query(
          "drop trigger if exists workspace_test_pause_invoice_order_mirror on orders"
        );
        await postgres.pool.query(
          "drop function if exists workspace_test_pause_invoice_order_mirror()"
        );
      }

      const [order] = await Effect.runPromise(
        postgres.db.select().from(orders).where(eq(orders.id, fixture.id))
      );
      expect(order).toBeDefined();
      expect(order!.activePaymentAttemptId).toBe(fixture.attemptId);
      expect(order!.fulfillmentState).toBe("fulfilled");
      expect(order!.fulfilledAt).not.toBeNull();
      expect(
        await Effect.runPromise(
          postgres.db
            .select()
            .from(invoices)
            .where(eq(invoices.workspaceReservationId, fixture.id))
        )
      ).toHaveLength(1);
    });
  }
);
