import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { type EmailDeliveryId, EmailDeliveryIdSchema } from "@deskohub/email";
import { inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { type FulfillmentState, workspaceReservations } from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  fulfillmentEmailFailureCode,
  type IWorkspaceReservationRepository,
  WorkspaceReservationRepository,
  WorkspaceReservationStateError,
} from "./workspace-reservation.repository";

const deliveryEventAt = (minute: number) =>
  Temporal.Instant.from(
    `2026-01-01T12:${minute.toString().padStart(2, "0")}:00.000Z`
  );

const newEmailDeliveryId = () =>
  EmailDeliveryIdSchema.make(`resend-${crypto.randomUUID()}`);

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "WorkspaceReservationRepository customer email delivery transitions on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    let reservations: IWorkspaceReservationRepository;
    const fixtureReservationIds: WorkspaceReservationId[] = [];

    const insertPaidReservationFixture = (input: {
      readonly fulfillmentState: FulfillmentState;
      readonly activeCustomerEmailDeliveryId?: EmailDeliveryId;
    }) =>
      Effect.gen(function* () {
        const id = workspaceReservationIdSchema.make(
          `reservation-${crypto.randomUUID()}`
        );
        yield* postgres.db.insert(workspaceReservations).values({
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
          reservationState: "confirmed",
          paymentState: "paid",
          paidAt: deliveryEventAt(0),
          reservationConfirmedAt: deliveryEventAt(0),
          fulfillmentState: input.fulfillmentState,
          activeCustomerEmailDeliveryId: input.activeCustomerEmailDeliveryId,
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
        });
        fixtureReservationIds.push(id);
        return id;
      });

    beforeAll(async () => {
      reservations = await Effect.runPromise(
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
        reservations.markAwaitingCustomerEmailDelivery({
          id,
          customerEmailDeliveryId,
        })
      );

      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.fulfillmentState).toBe("awaiting_delivery");
      expect(stored?.activeCustomerEmailDeliveryId).toEqual(
        customerEmailDeliveryId
      );
    });

    test("refuses to attach a reservation whose fulfillment is not processing", async () => {
      const id = await Effect.runPromise(
        insertPaidReservationFixture({ fulfillmentState: "not_started" })
      );

      const error = await Effect.runPromise(
        Effect.flip(
          reservations.markAwaitingCustomerEmailDelivery({
            id,
            customerEmailDeliveryId: newEmailDeliveryId(),
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
        reservations.markCustomerEmailDeliveryFulfilled({
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
        reservations.markCustomerEmailDeliveryFailed({
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
        reservations.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt,
        })
      );

      const updated = await Effect.runPromise(
        reservations.markCustomerEmailDeliveryFailed({
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

    test("rejects an older provider failure for a fulfilled delivery", async () => {
      const customerEmailDeliveryId = newEmailDeliveryId();
      const fulfilledAt = deliveryEventAt(20);
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "awaiting_delivery",
          activeCustomerEmailDeliveryId: customerEmailDeliveryId,
        })
      );
      await Effect.runPromise(
        reservations.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt,
        })
      );

      const updated = await Effect.runPromise(
        reservations.markCustomerEmailDeliveryFailed({
          customerEmailDeliveryId,
          failureCode: fulfillmentEmailFailureCode,
          failedAt: deliveryEventAt(15),
        })
      );

      expect(updated).toBeNull();
      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.fulfillmentState).toBe("fulfilled");
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
        reservations.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt,
        })
      );

      const updated = await Effect.runPromise(
        reservations.markCustomerEmailDeliveryFailed({
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
        reservations.markCustomerEmailDeliveryFailed({
          customerEmailDeliveryId,
          failureCode: fulfillmentEmailFailureCode,
          failedAt,
        })
      );

      const equalTimeRepair = await Effect.runPromise(
        reservations.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt: failedAt,
        })
      );
      expect(equalTimeRepair).toBeNull();

      const repaired = await Effect.runPromise(
        reservations.markCustomerEmailDeliveryFulfilled({
          customerEmailDeliveryId,
          fulfilledAt: deliveryEventAt(20),
        })
      );

      expect(repaired?.id).toEqual(id);
      expect(repaired?.fulfillmentState).toBe("fulfilled");
      expect(repaired?.fulfillmentFailedAt).toBeNull();
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
        reservations.markCustomerEmailDeliveryFailed({
          customerEmailDeliveryId,
          failureCode: "fulfillment_dotypos_failed",
          failedAt: deliveryEventAt(15),
        })
      );

      const updated = await Effect.runPromise(
        reservations.markCustomerEmailDeliveryFulfilled({
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
