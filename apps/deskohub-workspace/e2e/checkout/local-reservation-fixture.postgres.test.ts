import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { workspaceReservations } from "@/db/schema";
import { customerAccounts } from "@/db/schema/customer-accounts";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { E2EDatabase } from "../integrations/database.service";
import { withWorkspaceE2ELocalReservationFixture } from "./local-reservation-fixture";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const readReservation = (id: WorkspaceReservationId) =>
  testDatabase!.db
    .select()
    .from(workspaceReservations)
    .where(eq(workspaceReservations.id, id));

describe.skipIf(!testDatabase)(
  "Local reservation fixture on disposable Postgres",
  () => {
    test("seeds an expired hold authored by a new account and deletes it", async () => {
      const { fixture, row } = await withWorkspaceE2ELocalReservationFixture(
        (fixture) =>
          readReservation(fixture.reservationId).pipe(
            Effect.map(([row]) => ({ fixture, row }))
          )
      ).pipe(
        Effect.provideService(
          E2EDatabase,
          E2EDatabase.of({ db: testDatabase!.db })
        ),
        Effect.runPromise
      );

      expect(row).toMatchObject({
        checkoutAttemptKey: fixture.checkoutAttemptKey,
        checkoutSessionKey: fixture.checkoutSessionKey,
        dotyposCustomerId: fixture.customerId,
        dotyposReservationId: null,
        reservationState: "hold_expired",
        paymentState: "expired",
        fulfillmentState: "not_started",
        activePaymentAttemptId: null,
        activeCustomerEmailDeliveryId: null,
        reservationHoldExpiresAt: null,
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        },
        locale: "en-US",
      });
      expect(String(row?.reservationHoldExpiredAt)).toBe(
        String(row?.reservationCreatedAt)
      );

      expect(row?.authorAccountId).toStartWith("e2e-reservation-author-");
      const [author] = await testDatabase!.db
        .select({ dotyposCustomerId: customerAccounts.dotyposCustomerId })
        .from(customerAccounts)
        .where(eq(customerAccounts.id, row!.authorAccountId))
        .pipe(Effect.runPromise);
      expect(author).toEqual({ dotyposCustomerId: null });

      expect(
        await readReservation(fixture.reservationId).pipe(Effect.runPromise)
      ).toEqual([]);
    });
  }
);
