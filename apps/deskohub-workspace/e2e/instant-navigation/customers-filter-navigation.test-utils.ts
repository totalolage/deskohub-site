import "@/shared/testing/workspace-test-environment";

import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import {
  and,
  countDistinct,
  eq,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import { Effect, Schema } from "effect";
import { customerMarketingConsents } from "@/db/schema/customer-marketing-consents";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";

const decodeCustomerId = Schema.decodeSync(DotyposCustomerIdSchema);
const decodeReservationId = Schema.decodeSync(workspaceReservationIdSchema);

// The delayed-response soft-navigation lifecycle can only be proven against a
// locally controlled server and a disposable database, so reuse the app's
// database URL resolution chain for the disposable Postgres.
process.env.WORKSPACE_TEST_DATABASE_URL ??= process.env.DATABASE_URL;
export const customersFilterNavigationPostgres =
  await connectWorkspacePostgresTestDatabase();

const grantedAt = Temporal.Instant.from("2026-08-01T09:00:00Z");

export const softNavigationCustomerIds = [
  ...Array.from(
    { length: 26 },
    (_, index) => `e2e-soft-customer-${String(index + 1).padStart(2, "0")}`
  ),
  "e2e-soft-customer-withdrawn",
  "e2e-soft-customer-never",
] as const;

export const noJavaScriptCustomerIds = [
  "e2e-nojs-customer-granted-1",
  "e2e-nojs-customer-granted-2",
  "e2e-nojs-customer-withdrawn",
  "e2e-nojs-customer-never",
] as const;

const insertReservation = (
  store: WorkspacePostgresTestDatabase,
  customerId: string,
  updatedAt: Temporal.Instant
) =>
  Effect.runPromise(
    store.db.insert(workspaceReservations).values({
      id: decodeReservationId(`e2e-reservation-${customerId}`),
      checkoutAttemptKey: `e2e-reservation-${customerId}-attempt` as never,
      dotyposCustomerId: decodeCustomerId(customerId),
      reservationState: "draft",
      paymentState: "pending",
      fulfillmentState: "not_started",
      reservationDetails: {} as never,
      locale: "en-US",
      ...(updatedAt && { updatedAt }),
    })
  ).then(() => undefined);

const insertConsent = (
  store: WorkspacePostgresTestDatabase,
  customerId: string,
  withdrawnAt: Temporal.Instant | null
) =>
  Effect.runPromise(
    store.db.insert(customerMarketingConsents).values({
      dotyposCustomerId: decodeCustomerId(customerId),
      documentHash: `hash-${customerId}`,
      locale: "en-US",
      grantedAt,
      withdrawnAt,
    })
  ).then(() => undefined);

export const seedCustomers = async (
  store: WorkspacePostgresTestDatabase,
  customerIds: readonly string[],
  grantedCount: number
) => {
  for (const [index, customerId] of customerIds.entries()) {
    await insertReservation(
      store,
      customerId,
      Temporal.Instant.from("2026-08-10T09:00:00Z").add({ hours: index })
    );
    if (index < grantedCount) {
      await insertConsent(store, customerId, null);
    } else if (customerId.includes("withdrawn")) {
      await insertConsent(
        store,
        customerId,
        Temporal.Instant.from("2026-08-05T09:00:00Z")
      );
    }
  }
};

export const deleteSyntheticData = async (
  store: WorkspacePostgresTestDatabase,
  customerIds: readonly string[]
) => {
  const reservationIds = customerIds.map((customerId) =>
    decodeReservationId(`e2e-reservation-${customerId}`)
  );
  const consentCustomerIds = customerIds.map((customerId) =>
    decodeCustomerId(customerId)
  );
  await Effect.runPromise(
    store.db
      .delete(workspaceReservations)
      .where(inArray(workspaceReservations.id, reservationIds))
  );
  await Effect.runPromise(
    store.db
      .delete(customerMarketingConsents)
      .where(
        inArray(customerMarketingConsents.dotyposCustomerId, consentCustomerIds)
      )
  );
};

export const countDistinctCustomers = async (
  store: WorkspacePostgresTestDatabase,
  consent: "all" | "granted"
) => {
  const rows = await Effect.runPromise(
    store.db
      .select({
        value: countDistinct(workspaceReservations.dotyposCustomerId),
      })
      .from(workspaceReservations)
      .leftJoin(
        customerMarketingConsents,
        eq(
          customerMarketingConsents.dotyposCustomerId,
          workspaceReservations.dotyposCustomerId
        )
      )
      .where(
        consent === "granted"
          ? and(
              isNotNull(customerMarketingConsents.dotyposCustomerId),
              isNull(customerMarketingConsents.withdrawnAt)
            )
          : undefined
      )
  );
  return Number(rows[0]?.value ?? 0);
};
