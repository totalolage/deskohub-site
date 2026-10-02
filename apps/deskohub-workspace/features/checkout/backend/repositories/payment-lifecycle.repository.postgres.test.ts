import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { orders, paymentAttempts, workspaceReservations } from "@/db/schema";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { ensureReservationOrder } from "@/features/order/backend/reservation-order";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
} from "./payment-lifecycle.repository";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

/**
 * Builds a synthetic cowork snapshot whose provider identity matches the
 * fixture reservation and whose expected price is returned alongside.
 */
const makeSnapshot = (input: {
  readonly id: WorkspaceReservationId;
  readonly customerId: string;
  readonly dotyposReservationId: string;
}): {
  snapshot: AccountingDocumentSnapshot;
  amount: { value: number; exponent: number; currency: string };
} => {
  const document = makeCoworkInvoiceDocument("en-US");
  const {
    fulfilledAt: _fulfilledAt,
    invoiceNumber: _invoiceNumber,
    issuedAt: _issuedAt,
    paidAt: _paidAt,
    paymentAttemptId: _paymentAttemptId,
    supplier: invoiceSupplier,
    ...identity
  } = document;
  const { commercialRegister: _commercialRegister, ...supplier } =
    invoiceSupplier;

  const snapshot = Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
    ...identity,
    supplier,
    workspaceReservationId: input.id,
    dotyposCustomerId: input.customerId,
    dotyposReservationId: input.dotyposReservationId,
    billing: { purpose: "personal", invoice: "none" },
    delivery: { email: "synthetic@example.test" },
  });

  return { snapshot, amount: snapshot.quote.payment.expectedPrice };
};

const emptyCommitment = () =>
  makeDiscountCommitment({
    product: { kind: "cowork", tier: "basic" },
    applications: [],
  });

describe.skipIf(!postgresDatabase)(
  "PaymentLifecycleRepository order mirror on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    let repository: IPaymentLifecycleRepository;
    const fixtureReservationIds: WorkspaceReservationId[] = [];

    beforeAll(async () => {
      repository = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* PaymentLifecycleRepository;
        }).pipe(
          Effect.provide(
            PaymentLifecycleRepository.Default.pipe(
              Layer.provide(postgres.layer)
            )
          )
        )
      );
    });

    const insertHeldReservation = async () => {
      const id = workspaceReservationIdSchema.make(crypto.randomUUID());
      const customerId = `dotypos-customer-${crypto.randomUUID()}`;
      const dotyposReservationId = `dotypos-reservation-${crypto.randomUUID()}`;
      await Effect.runPromise(
        postgres.db.insert(workspaceReservations).values({
          id,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `attempt-${crypto.randomUUID()}`
          ),
          dotyposCustomerId: DotyposCustomerIdSchema.make(customerId),
          dotyposReservationId:
            DotyposReservationIdSchema.make(dotyposReservationId),
          reservationState: "held",
          paymentState: "not_started",
          fulfillmentState: "not_started",
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
          reservationHoldExpiresAt: Temporal.Instant.from(
            "2099-01-01T00:00:00Z"
          ),
        })
      );
      // Production always has the order from the reservation create path; the
      // mirror here reproduces that precondition.
      await Effect.runPromise(
        postgres.db.transaction((tx) =>
          Effect.gen(function* () {
            const [reservation] = yield* tx
              .select()
              .from(workspaceReservations)
              .where(eq(workspaceReservations.id, id))
              .limit(1);
            if (!reservation) {
              return yield* Effect.die("fixture reservation missing");
            }
            yield* ensureReservationOrder({ tx, reservation });
          })
        )
      );
      fixtureReservationIds.push(id);
      return { id, customerId, dotyposReservationId };
    };

    const loadOrder = async (id: WorkspaceReservationId) => {
      const rows = await Effect.runPromise(
        postgres.db.select().from(orders).where(eq(orders.id, id))
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    };

    afterEach(async () => {
      if (fixtureReservationIds.length === 0) return;
      const ids = [...fixtureReservationIds];
      fixtureReservationIds.length = 0;
      // Snapshot rows are immutable by trigger, so cleanup bypasses it on a
      // single dedicated connection.
      const client = await postgres.pool.connect();
      try {
        await client.query("set session_replication_role = replica");
        await client.query(
          "delete from accounting_document_snapshots where workspace_reservation_id = any($1)",
          [ids]
        );
        await client.query(
          "update orders set active_payment_attempt_id = null where id = any($1)",
          [ids]
        );
        await client.query("delete from orders where id = any($1)", [ids]);
        await client.query(
          "delete from workspace_reservations where id = any($1)",
          [ids]
        );
      } finally {
        await client
          .query("set session_replication_role = origin")
          .catch(() => {});
        client.release();
      }
    });

    test("payment start inserts the attempt with orderId equal to the reservation id and mirrors pending", async () => {
      const fixture = await insertHeldReservation();
      const { snapshot, amount } = makeSnapshot(fixture);

      const attempt = await Effect.runPromise(
        repository.createPendingNexiAttempt({
          workspaceReservationId: fixture.id,
          providerOrderId: NexiOrderIdSchema.make(
            `order-${crypto.randomUUID()}`
          ),
          amount,
          commitment: emptyCommitment(),
          locale: "en-US",
          accountingSnapshot: snapshot,
        })
      );

      expect(attempt.orderId).toBe(fixture.id);
      const attemptRows = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, attempt.id))
      );
      expect(attemptRows[0]!.orderId).toBe(fixture.id);

      const order = await loadOrder(fixture.id);
      expect(order.paymentState).toBe("pending");
      expect(order.activePaymentAttemptId).toBe(attempt.id);
      expect(order.fulfillmentState).toBe("not_started");
      expect(order.paidAt).toBeNull();
    });

    test("webhook complete mirrors paid without making the order invoice-eligible", async () => {
      const fixture = await insertHeldReservation();
      const { snapshot, amount } = makeSnapshot(fixture);

      const attempt = await Effect.runPromise(
        repository.createPendingNexiAttempt({
          workspaceReservationId: fixture.id,
          providerOrderId: NexiOrderIdSchema.make(
            `order-${crypto.randomUUID()}`
          ),
          amount,
          commitment: emptyCommitment(),
          locale: "en-US",
          accountingSnapshot: snapshot,
        })
      );

      const paidAt = Temporal.Now.instant();
      const transition = await Effect.runPromise(
        repository.markPaid({
          id: attempt.id,
          workspaceReservationId: fixture.id,
          webhookEventId: undefined,
          providerOperationId: undefined,
          providerStatus: "APPROVED",
          paidAt,
        })
      );
      expect(transition.changed).toBe(true);

      const order = await loadOrder(fixture.id);
      expect(order.paymentState).toBe("paid");
      // Instant columns keep microsecond precision; allow sub-microsecond drift.
      expect(
        Number(order.paidAt!.epochNanoseconds - paidAt.epochNanoseconds)
      ).toBeLessThan(1_000);
      expect(order.fulfillmentState).toBe("not_started");
      expect(order.fulfilledAt).toBeNull();
      // Invoice gate: paid alone must never be invoice-eligible.
      expect(
        order.fulfillmentState === "fulfilled" && order.fulfilledAt !== null
      ).toBe(false);
    });

    test("terminal payment failure mirrors the failure without losing timestamps", async () => {
      const fixture = await insertHeldReservation();
      const { snapshot, amount } = makeSnapshot(fixture);

      const attempt = await Effect.runPromise(
        repository.createPendingNexiAttempt({
          workspaceReservationId: fixture.id,
          providerOrderId: NexiOrderIdSchema.make(
            `order-${crypto.randomUUID()}`
          ),
          amount,
          commitment: emptyCommitment(),
          locale: "en-US",
          accountingSnapshot: snapshot,
        })
      );

      await Effect.runPromise(
        repository.markTerminal({
          id: attempt.id,
          workspaceReservationId: fixture.id,
          state: "failed",
          failureCode: "provider_declined",
        })
      );

      const order = await loadOrder(fixture.id);
      expect(order.paymentState).toBe("failed");
      expect(order.activePaymentAttemptId).toBe(attempt.id);
    });

    test("internal zero-total completion mirrors paid and replays idempotently", async () => {
      const fixture = await insertHeldReservation();

      // Zero-total snapshot: one item fully discounted to zero.
      const base = makeCoworkInvoiceDocument("en-US");
      const {
        fulfilledAt: _fulfilledAt,
        invoiceNumber: _invoiceNumber,
        issuedAt: _issuedAt,
        paidAt: _paidAt,
        paymentAttemptId: _paymentAttemptId,
        supplier: invoiceSupplier,
        ...identity
      } = base;
      const { commercialRegister: _commercialRegister, ...supplier } =
        invoiceSupplier;
      const itemTotal = base.quote.items.reduce(
        (total, item) => total + item.amount.value,
        0
      );
      const zero = { value: 0, exponent: 2, currency: "CZK" };
      const discountAmount = {
        value: itemTotal,
        exponent: base.quote.items[0]!.amount.exponent,
        currency: base.quote.items[0]!.amount.currency,
      };
      const snapshot = Schema.decodeUnknownSync(
        accountingDocumentSnapshotSchema
      )({
        ...identity,
        supplier,
        workspaceReservationId: fixture.id,
        dotyposCustomerId: fixture.customerId,
        dotyposReservationId: fixture.dotyposReservationId,
        quote: {
          ...base.quote,
          payment: {
            ...base.quote.payment,
            expectedPrice: zero,
            discounts: [
              {
                discount: {
                  id: discountIdSchema.make("internal-zero-discount"),
                  label: "Zero total",
                  adjustment: { kind: "percentage", basisPoints: 10_000 },
                },
                subtotalBefore: discountAmount,
                amount: discountAmount,
                subtotalAfter: zero,
              },
            ],
          },
        },
        billing: { purpose: "personal", invoice: "none" },
        delivery: { email: "synthetic@example.test" },
      });

      const complete = () =>
        Effect.runPromise(
          repository.completeInternalPayment({
            workspaceReservationId: fixture.id,
            amount: zero,
            commitment: makeDiscountCommitment({
              product: { kind: "cowork", tier: "basic" },
              applications: [
                {
                  application: snapshot.quote.payment.discounts[0]!,
                  candidate: {
                    provenance: {
                      providerNamespace: "test",
                      providerReference: "test",
                    },
                  },
                },
              ],
            }),
            locale: "en-US",
            accountingSnapshot: snapshot,
          })
        );
      const first = await complete();
      expect(first.changed).toBe(true);
      expect(first.attempt.provider).toBe("internal");
      expect(first.attempt.orderId).toBe(fixture.id);

      const order = await loadOrder(fixture.id);
      expect(order.paymentState).toBe("paid");
      expect(order.paidAt).not.toBeNull();

      // An old zero-total writer may have inserted its attempt after the
      // bridge backfill without persisting order_id. Replaying repairs the
      // database linkage without creating another order or attempt.
      await Effect.runPromise(
        postgres.db
          .update(paymentAttempts)
          .set({ orderId: null })
          .where(eq(paymentAttempts.id, first.attempt.id))
      );

      const replay = await complete();
      expect(replay.changed).toBe(false);
      expect(replay.attempt.id).toBe(first.attempt.id);
      const replayAgain = await complete();
      expect(replayAgain.changed).toBe(false);
      expect(replayAgain.attempt.id).toBe(first.attempt.id);

      const attemptRows = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, first.attempt.id))
      );
      expect(attemptRows).toHaveLength(1);
      expect(attemptRows[0]).toMatchObject({
        id: first.attempt.id,
        orderId: fixture.id,
        workspaceReservationId: fixture.id,
        provider: "internal",
        state: "paid",
        amountValue: 0,
        amountExponent: zero.exponent,
        currency: zero.currency,
      });
      const orderRows = await Effect.runPromise(
        postgres.db.select().from(orders).where(eq(orders.id, fixture.id))
      );
      expect(orderRows).toHaveLength(1);
      expect(orderRows[0]).toMatchObject({
        id: fixture.id,
        paymentState: "paid",
      });
    });
  }
);
