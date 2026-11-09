import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { type EmailDeliveryId, EmailDeliveryIdSchema } from "@deskohub/email";
import { inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { type FulfillmentState, workspaceReservations } from "@/db/schema";
import {
  type IWorkspaceReservationRepository,
  WorkspaceReservationRepository,
  WorkspaceReservationStateError,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  FulfillmentLedger,
  fulfillmentEmailFailureCode,
  type IFulfillmentLedger,
  WorkspaceReservationDeliveryGenerationSupersededError,
} from "./fulfillment-ledger.repository";

const deliveryEventAt = (minute: number) =>
  Temporal.Instant.from(
    `2026-01-01T12:${minute.toString().padStart(2, "0")}:00.000Z`
  );

const newEmailDeliveryId = () =>
  EmailDeliveryIdSchema.make(`resend-${crypto.randomUUID()}`);

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "FulfillmentLedger customer email delivery transitions on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    let reservations: IWorkspaceReservationRepository;
    let ledger: IFulfillmentLedger;
    const fixtureReservationIds: WorkspaceReservationId[] = [];

    const insertPaidReservationFixture = ({
      fulfillmentState,
      ...overrides
    }: {
      readonly fulfillmentState: FulfillmentState;
      readonly activeCustomerEmailDeliveryId?: EmailDeliveryId;
      readonly activeCustomerEmailDeliveryLocale?: "en-US" | "cs-CZ";
    }) =>
      workspaceFixtures(postgres.db)
        .reservation({
          stage: {
            reservation: "confirmed",
            payment: "paid",
            fulfillment: fulfillmentState,
          },
          at: deliveryEventAt(0),
          overrides,
        })
        .pipe(
          Effect.map(({ id }) => {
            fixtureReservationIds.push(id);
            return id;
          })
        );

    beforeAll(async () => {
      [reservations, ledger] = await Effect.runPromise(
        Effect.gen(function* () {
          return [
            yield* WorkspaceReservationRepository,
            yield* FulfillmentLedger,
          ] as const;
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              WorkspaceReservationRepository.Default,
              FulfillmentLedger.Default
            ).pipe(Layer.provide(postgres.layer))
          )
        )
      );
    });

    afterEach(async () => {
      if (fixtureReservationIds.length === 0) return;
      const ids = [...fixtureReservationIds];
      fixtureReservationIds.length = 0;
      await Effect.runPromise(
        postgres.db
          .delete(workspaceReservations)
          .where(inArray(workspaceReservations.id, ids))
      );
    });

    test("attaches a processing paid reservation to its customer delivery", async () => {
      const id = await Effect.runPromise(
        insertPaidReservationFixture({ fulfillmentState: "processing" })
      );
      const customerEmailDeliveryId = newEmailDeliveryId();

      await Effect.runPromise(
        ledger.markAwaitingCustomerEmailDelivery({
          id,
          customerEmailDeliveryId,
          expectedActiveCustomerEmailDeliveryId: null,
        })
      );

      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.fulfillmentState).toBe("awaiting_delivery");
      expect(stored?.activeCustomerEmailDeliveryId).toEqual(
        customerEmailDeliveryId
      );
    });

    test("does not seed the locale slot after the claimed generation closed", async () => {
      const id = await Effect.runPromise(
        insertPaidReservationFixture({ fulfillmentState: "processing" })
      );
      const recordedDeliveryId = newEmailDeliveryId();
      // The claimed initial generation is recorded by a concurrent worker
      // before the stalled writer resolves its locale.
      await Effect.runPromise(
        ledger.markAwaitingCustomerEmailDelivery({
          id,
          customerEmailDeliveryId: recordedDeliveryId,
          expectedActiveCustomerEmailDeliveryId: null,
        })
      );

      const authoritativeLocale = await Effect.runPromise(
        ledger.retainActiveCustomerEmailDeliveryLocale({
          id,
          locale: "cs-CZ",
          expectedActiveCustomerEmailDeliveryId: null,
        })
      );

      // The generation is closed: the stalled writer must not seed the newer
      // generation's slot nor borrow its locale.
      expect(authoritativeLocale).toBeNull();
      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.activeCustomerEmailDeliveryId).toEqual(recordedDeliveryId);
      expect(stored?.activeCustomerEmailDeliveryLocale).toBeNull();
    });

    test("does not return a newer generation's locale from the fallback read after advancement", async () => {
      const newerGenerationMarker = newEmailDeliveryId();
      const staleExpectedMarker = newEmailDeliveryId();
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "processing",
          activeCustomerEmailDeliveryId: newerGenerationMarker,
          activeCustomerEmailDeliveryLocale: "cs-CZ",
        })
      );

      // The slot is already seeded, so the conditional update cannot apply;
      // the fallback read must still be bound to the claimed generation.
      const authoritativeLocale = await Effect.runPromise(
        ledger.retainActiveCustomerEmailDeliveryLocale({
          id,
          locale: "en-US",
          expectedActiveCustomerEmailDeliveryId: staleExpectedMarker,
        })
      );

      expect(authoritativeLocale).toBeNull();
      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.activeCustomerEmailDeliveryLocale).toBe("cs-CZ");
    });

    test("clears the retained email locale when recording the accepted delivery", async () => {
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "processing",
          activeCustomerEmailDeliveryLocale: "cs-CZ",
        })
      );
      const customerEmailDeliveryId = newEmailDeliveryId();

      await Effect.runPromise(
        ledger.markAwaitingCustomerEmailDelivery({
          id,
          customerEmailDeliveryId,
          expectedActiveCustomerEmailDeliveryId: null,
        })
      );

      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.activeCustomerEmailDeliveryId).toEqual(
        customerEmailDeliveryId
      );
      expect(stored?.activeCustomerEmailDeliveryLocale).toBeNull();
    });

    test("clears the retained email locale when fulfillment records the accepted delivery", async () => {
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "processing",
          activeCustomerEmailDeliveryLocale: "cs-CZ",
        })
      );
      const customerEmailDeliveryId = newEmailDeliveryId();

      await Effect.runPromise(
        ledger.markFulfilled({
          id,
          fulfilledAt: deliveryEventAt(1),
          customerEmailDeliveryId,
        })
      );

      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.activeCustomerEmailDeliveryId).toEqual(
        customerEmailDeliveryId
      );
      expect(stored?.activeCustomerEmailDeliveryLocale).toBeNull();
    });

    test("returns the authoritative retained locale to a losing retain writer", async () => {
      const id = await Effect.runPromise(
        insertPaidReservationFixture({ fulfillmentState: "processing" })
      );

      const winnerLocale = await Effect.runPromise(
        ledger.retainActiveCustomerEmailDeliveryLocale({
          id,
          locale: "cs-CZ",
          expectedActiveCustomerEmailDeliveryId: null,
        })
      );
      // The second writer loses the null-slot race and must learn the
      // already-retained locale so its send matches the idempotency generation.
      const loserAuthoritativeLocale = await Effect.runPromise(
        ledger.retainActiveCustomerEmailDeliveryLocale({
          id,
          locale: "en-US",
          expectedActiveCustomerEmailDeliveryId: null,
        })
      );

      expect(winnerLocale).toBe("cs-CZ");
      expect(loserAuthoritativeLocale).toBe("cs-CZ");
      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.activeCustomerEmailDeliveryLocale).toBe("cs-CZ");
    });

    test("rejects an old-generation recording arriving after a newer recovery generation began", async () => {
      const newerGenerationMarker = newEmailDeliveryId();
      const staleExpectedMarker = newEmailDeliveryId();
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "processing",
          activeCustomerEmailDeliveryId: newerGenerationMarker,
          activeCustomerEmailDeliveryLocale: "cs-CZ",
        })
      );

      const error = await Effect.runPromise(
        Effect.flip(
          ledger.markAwaitingCustomerEmailDelivery({
            id,
            customerEmailDeliveryId: newEmailDeliveryId(),
            expectedActiveCustomerEmailDeliveryId: staleExpectedMarker,
          })
        )
      );

      expect(
        error instanceof WorkspaceReservationDeliveryGenerationSupersededError
      ).toBe(true);
      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.activeCustomerEmailDeliveryId).toEqual(
        newerGenerationMarker
      );
      expect(stored?.activeCustomerEmailDeliveryLocale).toBe("cs-CZ");
    });

    test("refuses to attach a reservation whose fulfillment is not processing", async () => {
      const id = await Effect.runPromise(
        insertPaidReservationFixture({ fulfillmentState: "not_started" })
      );

      const error = await Effect.runPromise(
        Effect.flip(
          ledger.markAwaitingCustomerEmailDelivery({
            id,
            customerEmailDeliveryId: newEmailDeliveryId(),
            expectedActiveCustomerEmailDeliveryId: null,
          })
        )
      );

      expect(error).toBeInstanceOf(WorkspaceReservationStateError);
      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.fulfillmentState).toBe("not_started");
      expect(stored?.activeCustomerEmailDeliveryId).toBeNull();
    });

    test("fulfills an awaiting customer delivery", async () => {
      const customerEmailDeliveryId = newEmailDeliveryId();
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "awaiting_delivery",
          activeCustomerEmailDeliveryId: customerEmailDeliveryId,
        })
      );
      const fulfilledAt = deliveryEventAt(15);

      const updated = await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt,
        })
      );

      expect(updated?.id).toEqual(id);
      expect(updated?.fulfillmentState).toBe("fulfilled");
      expect(updated?.fulfilledAt?.equals(fulfilledAt)).toBe(true);
      expect(updated?.fulfillmentFailedAt).toBeNull();
      expect(updated?.fulfillmentFailureCode).toBeNull();

      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.fulfillmentState).toBe("fulfilled");
      expect(stored?.activeCustomerEmailDeliveryId).toEqual(
        customerEmailDeliveryId
      );
    });

    test("fails an awaiting customer delivery with the provider failure code", async () => {
      const customerEmailDeliveryId = newEmailDeliveryId();
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "awaiting_delivery",
          activeCustomerEmailDeliveryId: customerEmailDeliveryId,
        })
      );
      const failedAt = deliveryEventAt(15);

      const updated = await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFailed({
          customerEmailDeliveryId,
          failureCode: fulfillmentEmailFailureCode,
          failedAt,
        })
      );

      expect(updated?.id).toEqual(id);
      expect(updated?.fulfillmentState).toBe("failed");
      expect(updated?.fulfillmentFailureCode).toBe(fulfillmentEmailFailureCode);
      expect(updated?.fulfillmentFailedAt?.equals(failedAt)).toBe(true);
      expect(updated?.fulfilledAt).toBeNull();

      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.fulfillmentState).toBe("failed");
    });

    test("rejects an equal-time provider failure for a fulfilled delivery", async () => {
      const customerEmailDeliveryId = newEmailDeliveryId();
      const fulfilledAt = deliveryEventAt(15);
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "awaiting_delivery",
          activeCustomerEmailDeliveryId: customerEmailDeliveryId,
        })
      );
      await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt,
        })
      );

      const updated = await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFailed({
          customerEmailDeliveryId,
          failureCode: fulfillmentEmailFailureCode,
          failedAt: fulfilledAt,
        })
      );

      expect(updated).toBeNull();
      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.fulfillmentState).toBe("fulfilled");
      expect(stored?.fulfilledAt?.equals(fulfilledAt)).toBe(true);
    });

    test("downgrades a fulfilled delivery when a newer provider failure arrives", async () => {
      const customerEmailDeliveryId = newEmailDeliveryId();
      const fulfilledAt = deliveryEventAt(15);
      const failedAt = deliveryEventAt(20);
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "awaiting_delivery",
          activeCustomerEmailDeliveryId: customerEmailDeliveryId,
        })
      );
      await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt,
        })
      );

      const updated = await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFailed({
          customerEmailDeliveryId,
          failureCode: fulfillmentEmailFailureCode,
          failedAt,
        })
      );

      expect(updated?.id).toEqual(id);
      expect(updated?.fulfillmentState).toBe("failed");
      expect(updated?.fulfillmentFailedAt?.equals(failedAt)).toBe(true);
      expect(updated?.fulfilledAt).toBeNull();
    });

    test("repairs a prior email delivery failure only for a strictly later success event", async () => {
      const customerEmailDeliveryId = newEmailDeliveryId();
      const failedAt = deliveryEventAt(15);
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "awaiting_delivery",
          activeCustomerEmailDeliveryId: customerEmailDeliveryId,
        })
      );
      await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFailed({
          customerEmailDeliveryId,
          failureCode: fulfillmentEmailFailureCode,
          failedAt,
        })
      );

      const equalTimeRepair = await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt: failedAt,
        })
      );
      expect(equalTimeRepair).toBeNull();

      const repaired = await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt: deliveryEventAt(20),
        })
      );

      expect(repaired?.id).toEqual(id);
      expect(repaired?.fulfillmentState).toBe("fulfilled");
      // The failure's time stays, so a status replay knows it failed first.
      expect(repaired?.fulfillmentFailedAt?.equals(failedAt)).toBe(true);
      expect(repaired?.fulfillmentFailureCode).toBeNull();
    });

    test("does not repair a delivery failure recorded under a different failure code", async () => {
      const customerEmailDeliveryId = newEmailDeliveryId();
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "awaiting_delivery",
          activeCustomerEmailDeliveryId: customerEmailDeliveryId,
        })
      );
      await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFailed({
          customerEmailDeliveryId,
          failureCode: "fulfillment_dotypos_failed",
          failedAt: deliveryEventAt(15),
        })
      );

      const updated = await Effect.runPromise(
        ledger.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt: deliveryEventAt(20),
        })
      );

      expect(updated).toBeNull();
      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.fulfillmentState).toBe("failed");
      expect(stored?.fulfillmentFailureCode).toBe("fulfillment_dotypos_failed");
    });
  }
);
