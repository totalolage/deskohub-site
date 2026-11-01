import "../../shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { withWorkspaceE2ELocalReservationFixture } from "../checkout/local-reservation-fixture";
import { E2EDatabase } from "./database.service";
import { readRunOwnedReservationRows } from "./owned-reservations";

const database = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!database)("all owned reservation DB sources", () => {
  test("includes retained paid rows without a provider link or payment attempt, by author and by customer", async () => {
    await Effect.runPromise(
      withWorkspaceE2ELocalReservationFixture((fixture) =>
        Effect.gen(function* () {
          const { db } = yield* E2EDatabase;
          const [row] = yield* db
            .select()
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, fixture.reservationId));
          yield* db
            .update(workspaceReservations)
            .set({ paymentState: "paid", paidAt: Temporal.Now.instant() })
            .where(eq(workspaceReservations.id, fixture.reservationId));
          const base = { intents: [], emails: [], journalCount: 1 };
          const authorRows = yield* readRunOwnedReservationRows({
            ...base,
            customerIds: [],
            accountIds: [row!.authorAccountId],
          });
          const customerRows = yield* readRunOwnedReservationRows({
            ...base,
            customerIds: [fixture.customerId],
            accountIds: [],
          });
          for (const rows of [authorRows, customerRows]) {
            expect(rows).toContainEqual({
              dotyposCustomerId: fixture.customerId,
              dotyposReservationId: null,
            });
          }
          expect(
            yield* readRunOwnedReservationRows({
              ...base,
              customerIds: [],
              accountIds: [],
            })
          ).toEqual([]);
        })
      ).pipe(Effect.provideService(E2EDatabase, { db: database!.db }))
    );
  });
});
