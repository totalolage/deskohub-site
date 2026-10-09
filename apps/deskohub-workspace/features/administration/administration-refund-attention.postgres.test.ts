import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import { paymentAttempts, workspaceReservations } from "@/db/schema";
import {
  checkoutAttemptKeySchema,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AdministrationService } from "./administration.service";
import { PaymentAdministrationServiceMock } from "./payment-administration.service.mock";
import { PostHogReservationHistory } from "./posthog-reservation-history";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "Administration refund attention on disposable Postgres",
  () => {
    const postgres = testDatabase;
    if (!postgres) return;
    const reservationIds: WorkspaceReservationId[] = [];
    const runId = crypto.randomUUID();
    const customerId = DotyposCustomerIdSchema.make(`refund-customer-${runId}`);

    afterAll(async () => {
      await postgres.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await postgres.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const run = <A, E>(
      operation: (
        administration: typeof AdministrationService.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* AdministrationService);
        }).pipe(
          Effect.provide(
            AdministrationService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  postgres.layer,
                  DotyposServiceMock({
                    getCustomer: () => Effect.succeed(null as never),
                    getCustomers: () => Effect.succeed([]),
                    listReservations: () => Effect.succeed([]),
                  }),
                  Layer.succeed(
                    PostHogReservationHistory,
                    PostHogReservationHistory.of({
                      load: () =>
                        Effect.succeed({ kind: "unavailable" } as const),
                    })
                  ),
                  PaymentAdministrationServiceMock({})
                )
              )
            )
          )
        )
      );

    /** Inserts a paid, cancelled checkout with one attempt per refund state. */
    const insertPaidCheckout = async (
      label: string,
      refundStates: readonly ("not_required" | "required" | "refunded")[]
    ) => {
      const id = `${label}-${runId}`;
      const reservationId = workspaceReservationIdSchema.make(`refund-${id}`);
      reservationIds.push(reservationId);
      await Effect.runPromise(
        postgres.db.insert(workspaceReservations).values({
          id: reservationId,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(`attempt-${id}`),
          dotyposCustomerId: customerId,
          dotyposReservationId: DotyposReservationIdSchema.make(
            `booking-${id}`
          ),
          reservationState: "cancelled",
          paymentState: "paid",
          paidAt: Temporal.Now.instant(),
          fulfillmentState: "not_started",
          reservationDetails: {
            kind: "cowork",
            entryTier: "open-space",
            coffee: false,
          },
          locale: "en-US",
        })
      );
      for (const [index, refundState] of refundStates.entries()) {
        await Effect.runPromise(
          postgres.db.insert(paymentAttempts).values({
            id: paymentAttemptIdSchema.make(`attempt-${index}-${id}`),
            workspaceReservationId: reservationId,
            provider: "nexi",
            providerOrderId: NexiOrderIdSchema.make(`order-${index}-${id}`),
            state: "paid",
            refundState,
            ...(refundState === "refunded" && {
              refundedAmountValue: 29_000,
              refundedAt: Temporal.Instant.from("2026-10-05T08:30:00Z"),
            }),
            amountValue: 29_000,
            amountExponent: 2,
            currency: "CZK",
            // Later attempts are newer, so the last one is the latest payment.
            createdAt: Temporal.Now.instant().add({ seconds: index }),
          })
        );
      }
      return reservationId;
    };

    test("counts and filters every reservation with a payment needing a refund", async () => {
      const before = await run((administration) =>
        administration.countReservationsNeedingRefund()
      );

      const refundedTwice = await insertPaidCheckout("twice", [
        "required",
        "required",
      ]);
      const olderAttemptRefund = await insertPaidCheckout("older", [
        "required",
        "not_required",
      ]);
      await insertPaidCheckout("settled", ["not_required"]);
      const refunded = await insertPaidCheckout("refunded", [
        "refunded",
        "not_required",
      ]);

      const after = await run((administration) =>
        administration.countReservationsNeedingRefund()
      );
      expect(after - before).toBe(2);

      const listed = await run((administration) =>
        administration.listReservations({
          customerId,
          status: "needs_refund",
        })
      );
      expect(listed.total).toBe(2);
      expect(listed.items.map(({ id }) => id).sort()).toEqual(
        [refundedTwice, olderAttemptRefund].sort()
      );
      for (const item of listed.items) {
        expect(item.statusNote).toBe("Needs refund");
      }

      const cancelled = await run((administration) =>
        administration.listReservations({
          customerId,
          status: "cancelled",
        })
      );
      expect(
        cancelled.items.find(({ id }) => id === refunded)?.statusNote
      ).toBe("Refunded");
    });
  }
);
