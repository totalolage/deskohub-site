import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  customerAccounts,
  customerEvents,
  workspaceReservations,
} from "@/db/schema";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { recordCustomerEvent } from "./customer-event-outbox";
import {
  CustomerEventReconciler,
  type CustomerEventReconciliation,
  customerEventReconcileBatchSize,
} from "./customer-event-reconciler";

const testDatabase = await connectWorkspacePostgresTestDatabase();

// The reconciler reads whole tables. Each test runs at its own instant in a
// distant year, so its 35-day window reaches only the rows it inserted.
const nowInYear = (year: number) =>
  Temporal.Instant.from(`${year}-06-01T12:00:00Z`);

const nothingReconciled: CustomerEventReconciliation = {
  booked: 0,
  cancelled: 0,
  accountCreated: 0,
};

describe.skipIf(!testDatabase)(
  "CustomerEventReconciler on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];
    const accountIds: CustomerAccountId[] = [];

    afterAll(async () => {
      // Deleting a reservation or an account also deletes its events.
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        `delete from auth."user" where id = any($1)`,
        [accountIds]
      );
      await testDatabase.pool.query(
        "delete from customer_accounts where id = any($1)",
        [accountIds]
      );
    });

    const reconcileAt = (now: Temporal.Instant) =>
      Effect.runPromise(
        TestClock.setTime(now.epochMilliseconds).pipe(
          Effect.andThen(
            Effect.flatMap(
              CustomerEventReconciler,
              (reconciler) => reconciler.reconcile
            )
          ),
          Effect.provide(
            Layer.merge(
              CustomerEventReconciler.Default.pipe(
                Layer.provide(testDatabase.layer)
              ),
              TestClock.layer()
            )
          )
        )
      );

    /** Inserts synthetic reservations as a writer without the outbox would. */
    const insertReservations = async (
      reservations: ReadonlyArray<
        Partial<typeof workspaceReservations.$inferInsert>
      >
    ) => {
      const rows = reservations.map((values) => {
        const key = crypto.randomUUID();
        const id = workspaceReservationIdSchema.make(`reconcile-${key}`);
        reservationIds.push(id);
        return {
          id,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(`attempt-${key}`),
          dotyposCustomerId: DotyposCustomerIdSchema.make(`customer-${key}`),
          dotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-reservation-${key}`
          ),
          reservationState: "confirmed",
          paymentState: "paid",
          paidAt: Temporal.Instant.from("2090-01-01T00:00:00Z"),
          fulfillmentState: "not_started",
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
          ...values,
          authorAccountId: values.authorAccountId ?? fixtureReservationAuthorId,
        } satisfies typeof workspaceReservations.$inferInsert;
      });
      await Effect.runPromise(
        testDatabase.db.insert(workspaceReservations).values(rows)
      );
      return rows.map((row) => row.id);
    };

    const insertReservation = async (
      values: Partial<typeof workspaceReservations.$inferInsert>
    ) => {
      const [id] = await insertReservations([values]);
      return id!;
    };

    const readEvents = (id: WorkspaceReservationId) =>
      Effect.runPromise(
        testDatabase.db
          .select({
            kind: customerEvents.kind,
            occurredAt: customerEvents.occurredAt,
          })
          .from(customerEvents)
          .where(eq(customerEvents.workspaceReservationId, id))
          .orderBy(customerEvents.occurredAt)
      );

    test("records one booked event at the confirmation time, however often it runs", async () => {
      const now = nowInYear(2090);
      const confirmedAt = now.subtract({ hours: 1 });
      const id = await insertReservation({
        reservationConfirmedAt: confirmedAt,
      });

      expect(await reconcileAt(now)).toEqual({
        ...nothingReconciled,
        booked: 1,
      });
      expect(await reconcileAt(now)).toEqual(nothingReconciled);
      expect(await readEvents(id)).toEqual([
        { kind: "reservation-booked", occurredAt: confirmedAt },
      ]);
    });

    test("leaves one booked event alongside the outbox", async () => {
      const now = nowInYear(2091);
      const confirmedAt = now.subtract({ hours: 1 });
      const [recordedFirst, reconciledFirst] = await insertReservations([
        { reservationConfirmedAt: confirmedAt },
        { reservationConfirmedAt: confirmedAt },
      ]);
      const recordOutbox = async (id: WorkspaceReservationId) => {
        const [reservation] = await Effect.runPromise(
          testDatabase.db
            .select({
              dotyposCustomerId: workspaceReservations.dotyposCustomerId,
            })
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, id))
        );
        await Effect.runPromise(
          recordCustomerEvent(testDatabase.db, {
            kind: "reservation-booked",
            occurredAt: confirmedAt,
            dotyposCustomerId: reservation!.dotyposCustomerId,
            workspaceReservationId: id,
          })
        );
      };

      await recordOutbox(recordedFirst!);
      expect(await reconcileAt(now)).toEqual({
        ...nothingReconciled,
        booked: 1,
      });
      await recordOutbox(reconciledFirst!);

      for (const id of [recordedFirst!, reconciledFirst!]) {
        expect(await readEvents(id)).toEqual([
          { kind: "reservation-booked", occurredAt: confirmedAt },
        ]);
      }
    });

    test("records the cancellation of a confirmed booking and nothing for an unconfirmed one", async () => {
      const now = nowInYear(2092);
      const confirmedAt = now.subtract({ hours: 3 });
      const cancelledAt = now.subtract({ hours: 2 });
      const confirmed = await insertReservation({
        reservationState: "cancelled",
        reservationConfirmedAt: confirmedAt,
        reservationCancelledAt: cancelledAt,
      });
      const unconfirmed = await insertReservation({
        reservationState: "cancelled",
        paymentState: "failed",
        paidAt: null,
        reservationCancelledAt: cancelledAt,
      });

      expect(await reconcileAt(now)).toEqual({
        ...nothingReconciled,
        booked: 1,
        cancelled: 1,
      });
      expect(await reconcileAt(now)).toEqual(nothingReconciled);
      expect(await readEvents(confirmed)).toEqual([
        { kind: "reservation-booked", occurredAt: confirmedAt },
        { kind: "reservation-cancelled", occurredAt: cancelledAt },
      ]);
      expect(await readEvents(unconfirmed)).toEqual([]);
    });

    test("ignores confirmations older than 35 days", async () => {
      const now = nowInYear(2093);
      const [tooOld, recent] = await insertReservations([
        { reservationConfirmedAt: now.subtract({ hours: 36 * 24 }) },
        { reservationConfirmedAt: now.subtract({ hours: 34 * 24 }) },
      ]);

      expect(await reconcileAt(now)).toEqual({
        ...nothingReconciled,
        booked: 1,
      });
      expect(await readEvents(tooOld!)).toEqual([]);
      expect(await readEvents(recent!)).toHaveLength(1);
    });

    test("records at most a batch per kind, oldest first", async () => {
      const now = nowInYear(2094);
      const ids = await insertReservations(
        Array.from(
          { length: customerEventReconcileBatchSize + 1 },
          (_, index) => ({
            reservationConfirmedAt: now.subtract({
              minutes: customerEventReconcileBatchSize + 1 - index,
            }),
          })
        )
      );
      const newest = ids.at(-1)!;

      expect(await reconcileAt(now)).toEqual({
        ...nothingReconciled,
        booked: customerEventReconcileBatchSize,
      });
      expect(await readEvents(ids[0]!)).toHaveLength(1);
      expect(await readEvents(newest)).toEqual([]);
      expect(await reconcileAt(now)).toEqual({
        ...nothingReconciled,
        booked: 1,
      });
      expect(await readEvents(newest)).toHaveLength(1);
    });

    test("records account creation for a linked account at its creation time", async () => {
      const now = nowInYear(2095);
      const createdAt = now.subtract({ hours: 5 });
      const insertAccount = async (
        linkedCustomer: string | null,
        emailVerified: boolean,
        legacy = false
      ) => {
        const id = customerAccountIdSchema.make(crypto.randomUUID());
        accountIds.push(id);
        await Effect.runPromise(
          testDatabase.db
            .insert(customerAccounts)
            .values({ id, createdAt, legacy })
        );
        await testDatabase.pool.query(
          `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, $3)`,
          [id, testEmailAddress(`reconcile-${id}`), emailVerified]
        );
        if (linkedCustomer) {
          await Effect.runPromise(
            testDatabase.db
              .update(customerAccounts)
              .set({
                dotyposCustomerId: DotyposCustomerIdSchema.make(linkedCustomer),
              })
              .where(eq(customerAccounts.id, id))
          );
        }
        return id;
      };
      const linkedCustomer = crypto.randomUUID();
      const unverifiedCustomer = crypto.randomUUID();
      const linked = await insertAccount(linkedCustomer, true);
      const unverified = await insertAccount(unverifiedCustomer, false);
      const unlinked = await insertAccount(null, true);
      // An existing customer's verified account is never a new one.
      const legacy = await insertAccount(crypto.randomUUID(), true, true);
      const readAccountEvents = (id: CustomerAccountId) =>
        Effect.runPromise(
          testDatabase.db
            .select({
              kind: customerEvents.kind,
              occurredAt: customerEvents.occurredAt,
              dotyposCustomerId: customerEvents.dotyposCustomerId,
            })
            .from(customerEvents)
            .where(eq(customerEvents.customerAccountId, id))
        );

      expect(await reconcileAt(now)).toEqual({
        ...nothingReconciled,
        accountCreated: 1,
      });
      expect(await reconcileAt(now)).toEqual(nothingReconciled);
      expect(await readAccountEvents(linked)).toEqual([
        {
          kind: "account-created",
          occurredAt: createdAt,
          dotyposCustomerId: DotyposCustomerIdSchema.make(linkedCustomer),
        },
      ]);
      expect(await readAccountEvents(unverified)).toEqual([]);
      expect(await readAccountEvents(unlinked)).toEqual([]);
      expect(await readAccountEvents(legacy)).toEqual([]);
    });
  }
);
