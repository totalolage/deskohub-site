import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { workspaceReservations } from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { floorToWholeHour } from "@/shared/utils/temporal";
import type { DatasourceConfig } from "../config";
import { E2EDatabase } from "../integrations/database.service";
import { withWorkspaceE2EReservationHistoryFixture } from "./reservation-history-fixture";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const readReservation = (id: WorkspaceReservationId) =>
  testDatabase!.db
    .select()
    .from(workspaceReservations)
    .where(eq(workspaceReservations.id, id));

describe.skipIf(!testDatabase)(
  "Account reservation history fixture on disposable Postgres",
  () => {
    test("seeds a fulfilled paid booking authored by the linked account and deletes it", async () => {
      const customerId = DotyposCustomerIdSchema.make(
        `account-history-customer-${crypto.randomUUID()}`
      );
      const dotyposReservationId = DotyposReservationIdSchema.make(
        `account-history-provider-${crypto.randomUUID()}`
      );
      const startsAt = floorToWholeHour(
        Temporal.Now.zonedDateTimeISO("UTC").add({ days: 120 })
      ).toInstant();
      const linkedAccountId = await workspaceFixtures(testDatabase!.db)
        .customerAccount({ linkedCustomer: customerId })
        .pipe(Effect.runPromise);

      const { fixture, row } = await withWorkspaceE2EReservationHistoryFixture(
        {
          customerId,
          datasourceConfig: {} as DatasourceConfig,
          dotyposReservationId,
        },
        (fixture) =>
          readReservation(fixture.reservationId).pipe(
            Effect.map(([row]) => ({ fixture, row }))
          ),
        {
          readProviderReservation: () =>
            Effect.succeed({
              customer: { id: customerId },
              reservation: {
                _customerId: customerId,
                endDate: startsAt.add({ hours: 8 }).toString(),
                id: dotyposReservationId,
                startDate: startsAt.toString(),
                status: "CONFIRMED",
              },
            }),
        }
      ).pipe(
        Effect.provideService(
          E2EDatabase,
          E2EDatabase.of({ db: testDatabase!.db })
        ),
        Effect.runPromise
      );

      expect(row).toMatchObject({
        authorAccountId: linkedAccountId,
        dotyposCustomerId: customerId,
        dotyposReservationId,
        reservationState: "confirmed",
        paymentState: "paid",
        fulfillmentState: "fulfilled",
        activePaymentAttemptId: null,
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        },
        locale: "en-US",
      });
      const createdAt = String(row?.reservationCreatedAt);
      expect(String(row?.reservationConfirmedAt)).toBe(createdAt);
      expect(String(row?.paidAt)).toBe(createdAt);
      expect(String(row?.fulfilledAt)).toBe(createdAt);

      expect(
        await readReservation(fixture.reservationId).pipe(Effect.runPromise)
      ).toEqual([]);
    });
  }
);
