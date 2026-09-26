import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { Effect, Layer } from "effect";
import { customerMarketingConsents } from "@/db/schema/customer-marketing-consents";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type AdministrationCustomerListInput,
  AdministrationService,
} from "./administration.service";
import { PaymentAdministrationServiceMock } from "./payment-administration.service.mock";
import { PostHogReservationHistory } from "./posthog-reservation-history";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

const grantedAt = Temporal.Instant.from("2026-08-01T09:00:00Z");
const withdrawnAt = Temporal.Instant.from("2026-08-02T09:00:00Z");

const insertReservation = (
  postgres: WorkspacePostgresTestDatabase,
  id: string,
  customerId: string
) =>
  Effect.runPromise(
    postgres.db.insert(workspaceReservations).values({
      id,
      checkoutAttemptKey: `${id}-attempt` as never,
      dotyposCustomerId: customerId as DotyposCustomerId,
      reservationState: "draft",
      paymentState: "pending",
      fulfillmentState: "not_started",
      reservationDetails: {} as never,
      locale: "en-US",
    })
  ).then(() => undefined);

const insertConsent = (
  postgres: WorkspacePostgresTestDatabase,
  customerId: string,
  withdrawn: Temporal.Instant | null
) =>
  Effect.runPromise(
    postgres.db.insert(customerMarketingConsents).values({
      dotyposCustomerId: customerId as DotyposCustomerId,
      documentHash: `hash-${customerId}`,
      locale: "en-US",
      grantedAt,
      withdrawnAt: withdrawn,
    })
  ).then(() => undefined);

describe.skipIf(!postgresDatabase)(
  "listCustomers marketing consent filter on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;

    const makeService = () =>
      Effect.gen(function* () {
        const administration = yield* AdministrationService;
        return administration;
      }).pipe(
        Effect.provide(
          AdministrationService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                postgres.layer,
                DotyposServiceMock({
                  getCustomer: (id: string) => Effect.succeed({ id }),
                  getCustomers: () => Effect.succeed([]),
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
        ),
        Effect.runPromise
      );

    const seedMixedConsentData = async () => {
      await insertReservation(postgres, "reservation-granted", "granted-c");
      await insertReservation(postgres, "reservation-withdrawn", "withdrawn-c");
      await insertReservation(postgres, "reservation-never", "never-c");
      await insertConsent(postgres, "granted-c", null);
      await insertConsent(postgres, "withdrawn-c", withdrawnAt);
    };

    test("Granted matches only an active grant, never a withdrawn grant or a missing consent row", async () => {
      await seedMixedConsentData();
      try {
        const administration = await makeService();
        const result = await Effect.runPromise(
          administration.listCustomers({
            marketingConsent: "granted",
          } satisfies AdministrationCustomerListInput)
        );
        expect(result.total).toBe(1);
        expect(result.items.map((item) => item.customerId)).toEqual([
          "granted-c",
        ]);
        expect(result.items[0]?.marketingConsent).toBe("granted");
      } finally {
        await Effect.runPromise(postgres.db.delete(workspaceReservations));
        await Effect.runPromise(postgres.db.delete(customerMarketingConsents));
      }
    });

    test("Withdrawn matches only withdrawn grants and Never matches only missing consent rows", async () => {
      await seedMixedConsentData();
      try {
        const administration = await makeService();

        const withdrawnResult = await Effect.runPromise(
          administration.listCustomers({
            marketingConsent: "withdrawn",
          } satisfies AdministrationCustomerListInput)
        );
        expect(withdrawnResult.total).toBe(1);
        expect(withdrawnResult.items[0]?.customerId).toBe("withdrawn-c");
        expect(withdrawnResult.items[0]?.marketingConsent).toBe("withdrawn");

        const neverResult = await Effect.runPromise(
          administration.listCustomers({
            marketingConsent: "never",
          } satisfies AdministrationCustomerListInput)
        );
        expect(neverResult.total).toBe(1);
        expect(neverResult.items[0]?.customerId).toBe("never-c");
        expect(neverResult.items[0]?.marketingConsent).toBe("never");
      } finally {
        await Effect.runPromise(postgres.db.delete(workspaceReservations));
        await Effect.runPromise(postgres.db.delete(customerMarketingConsents));
      }
    });
  }
);
