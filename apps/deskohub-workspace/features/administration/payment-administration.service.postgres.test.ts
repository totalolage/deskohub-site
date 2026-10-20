import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { NexiServiceMock } from "@deskohub/nexi/backend/service.mock";
import { Effect, Layer } from "effect";
import { paymentAttempts, workspaceReservations } from "@/db/schema";
import {
  checkoutAttemptKeySchema,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { PaymentAdministrationService } from "./payment-administration.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "PaymentAdministrationService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const runId = crypto.randomUUID();
    const reservationId = workspaceReservationIdSchema.make(
      `payment-admin-${runId}`
    );

    afterAll(async () => {
      // Payment attempts cascade with their reservation.
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = $1",
        [reservationId]
      );
    });

    const insertOrder = (
      label: string,
      times: {
        readonly attemptCreatedAt: string;
        readonly providerOrderCreatedAt: string | null;
      }
    ) => {
      const providerOrderId = NexiOrderIdSchema.make(`${label}-${runId}`);
      return Effect.runPromise(
        testDatabase.db.insert(paymentAttempts).values({
          id: paymentAttemptIdSchema.make(`attempt-${label}-${runId}`),
          workspaceReservationId: reservationId,
          provider: "nexi",
          providerOrderId,
          state: "paid",
          amountValue: 5000,
          amountExponent: 2,
          currency: "CZK",
          createdAt: Temporal.Instant.from(times.attemptCreatedAt),
          providerOrderCreatedAt:
            times.providerOrderCreatedAt === null
              ? null
              : Temporal.Instant.from(times.providerOrderCreatedAt),
        })
      ).then(() => providerOrderId);
    };

    test("filters local orders by provider order creation time, falling back to attempt creation", async () => {
      await Effect.runPromise(
        testDatabase.db.insert(workspaceReservations).values({
          authorAccountId: fixtureReservationAuthorId,
          id: reservationId,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(`attempt-${runId}`),
          dotyposCustomerId: DotyposCustomerIdSchema.make(
            `payment-admin-customer-${runId}`
          ),
          dotyposReservationId: DotyposReservationIdSchema.make(
            `payment-admin-booking-${runId}`
          ),
          reservationState: "confirmed",
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
      // The window is far in the past so other suites' orders stay outside it.
      const providerTimeInside = await insertOrder("provider-time-inside", {
        attemptCreatedAt: "2001-09-01T10:00:00Z",
        providerOrderCreatedAt: "2001-08-05T10:00:00Z",
      });
      const attemptTimeFallback = await insertOrder("attempt-time-fallback", {
        attemptCreatedAt: "2001-08-04T10:00:00Z",
        providerOrderCreatedAt: null,
      });
      await insertOrder("provider-time-before", {
        attemptCreatedAt: "2001-08-03T10:00:00Z",
        providerOrderCreatedAt: "2001-07-20T10:00:00Z",
      });
      await insertOrder("provider-time-after", {
        attemptCreatedAt: "2001-08-03T11:00:00Z",
        providerOrderCreatedAt: "2001-08-07T00:00:00Z",
      });

      const result = await Effect.gen(function* () {
        const administration = yield* PaymentAdministrationService;
        return yield* administration.listOrders({
          fromTime: "2001-08-01T00:00:00Z",
          toTime: "2001-08-07T00:00:00Z",
        });
      }).pipe(
        Effect.provide(
          PaymentAdministrationService.Default.pipe(
            Layer.provide(
              Layer.merge(
                testDatabase.layer,
                NexiServiceMock({ listOrders: () => Effect.succeed([]) })
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(result.items.map(({ orderId }) => orderId).sort()).toEqual(
        [providerTimeInside, attemptTimeFallback].sort()
      );
    });
  }
);
