import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { type EmailDeliveryId, EmailDeliveryIdSchema } from "@deskohub/email";
import { inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { type FulfillmentState, workspaceReservations } from "@/db/schema";
import {
  type IWorkspaceReservationRepository,
  WorkspaceReservationRepository,
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
} from "./fulfillment-ledger.repository";

const paidAt = Temporal.Instant.from("2026-01-01T12:00:00.000Z");

const newEmailDeliveryId = () =>
  EmailDeliveryIdSchema.make(`resend-${crypto.randomUUID()}`);

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "FulfillmentLedger paid fulfillment claim on Postgres",
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
    }) =>
      workspaceFixtures(postgres.db)
        .reservation({
          stage: {
            reservation: "confirmed",
            payment: "paid",
            fulfillment: fulfillmentState,
          },
          at: paidAt,
          overrides: {
            ...(fulfillmentState === "failed" && {
              fulfillmentFailureCode: fulfillmentEmailFailureCode,
            }),
            ...overrides,
          },
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

    test("reclaims a failed customer delivery into processing and keeps its delivery id", async () => {
      const customerEmailDeliveryId = newEmailDeliveryId();
      const id = await Effect.runPromise(
        insertPaidReservationFixture({
          fulfillmentState: "failed",
          activeCustomerEmailDeliveryId: customerEmailDeliveryId,
        })
      );

      const claimed = await Effect.runPromise(
        ledger.claimPaidFulfillment({
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
