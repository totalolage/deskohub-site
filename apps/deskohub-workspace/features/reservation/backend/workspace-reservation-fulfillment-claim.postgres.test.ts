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
  fixtureReservationAuthorId,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  fulfillmentEmailFailureCode,
  type IWorkspaceReservationRepository,
  WorkspaceReservationRepository,
} from "./workspace-reservation.repository";

const paidAt = Temporal.Instant.from("2026-01-01T12:00:00.000Z");

const newEmailDeliveryId = () =>
  EmailDeliveryIdSchema.make(`resend-${crypto.randomUUID()}`);

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "WorkspaceReservationRepository paid fulfillment claim on Postgres",
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
        fixtureReservationIds.push(id);
        yield* postgres.db.insert(workspaceReservations).values({
          authorAccountId: fixtureReservationAuthorId,
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
          paidAt,
          reservationConfirmedAt: paidAt,
          fulfillmentState: input.fulfillmentState,
          ...(input.fulfillmentState === "failed" && {
            fulfillmentFailedAt: paidAt,
            fulfillmentFailureCode: fulfillmentEmailFailureCode,
          }),
          activeCustomerEmailDeliveryId: input.activeCustomerEmailDeliveryId,
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
        });
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

    test("reclaims a failed customer delivery into processing and keeps its delivery id", async () => {
      const customerEmailDeliveryId = newEmailDeliveryId();
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "failed",
          activeCustomerEmailDeliveryId: customerEmailDeliveryId,
        })
      );

      const claimed = await Effect.runPromise(
        reservations.claimPaidFulfillment({
          id,
          staleProcessingBefore: Temporal.Now.instant(),
        })
      );

      expect(claimed?.id).toEqual(id);
      expect(claimed?.fulfillmentState).toBe("processing");
      expect(claimed?.activeCustomerEmailDeliveryId).toEqual(
        customerEmailDeliveryId
      );
      const stored = await Effect.runPromise(reservations.findById(id));
      expect(stored?.fulfillmentState).toBe("processing");
      expect(stored?.activeCustomerEmailDeliveryId).toEqual(
        customerEmailDeliveryId
      );
    });

    test.each([
      {
        fulfillmentState: "awaiting_delivery",
        activeCustomerEmailDeliveryId: null,
        constraint: "workspace_reservations_awaiting_delivery_check",
      },
      {
        fulfillmentState: "not_started",
        activeCustomerEmailDeliveryId: newEmailDeliveryId(),
        constraint: "workspace_reservations_active_email_delivery_state_check",
      },
    ] satisfies readonly {
      readonly fulfillmentState: FulfillmentState;
      readonly activeCustomerEmailDeliveryId: EmailDeliveryId | null;
      readonly constraint: string;
    }[])(
      "rejects $fulfillmentState fulfillment that contradicts its customer delivery",
      async ({
        fulfillmentState,
        activeCustomerEmailDeliveryId,
        constraint,
      }) => {
        const id = await Effect.runPromise(
          insertPaidReservationFixture({ fulfillmentState: "processing" })
        );

        await expect(
          postgres.pool.query(
            `update workspace_reservations
               set fulfillment_state = $2, active_customer_email_delivery_id = $3
             where id = $1`,
            [id, fulfillmentState, activeCustomerEmailDeliveryId]
          )
        ).rejects.toMatchObject({ code: "23514", constraint });
      }
    );
  }
);
