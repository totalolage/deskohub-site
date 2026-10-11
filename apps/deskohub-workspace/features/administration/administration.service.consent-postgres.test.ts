import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { inArray } from "drizzle-orm";
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
const paginationSortInstant = Temporal.Instant.from("2026-08-03T09:00:00Z");

const mixedConsentCustomerIds = [
  "granted-c",
  "withdrawn-c",
  "never-c",
] as const;
const mixedConsentReservationIds = [
  "reservation-granted",
  "reservation-withdrawn",
  "reservation-never",
] as const;
const paginationCustomerIds = Array.from(
  { length: 26 },
  (_, index) => `pagination-customer-${String(index + 1).padStart(2, "0")}`
);
const paginationExcludedCustomerIds = [
  "pagination-withdrawn",
  "pagination-never",
] as const;
const paginationTestCustomerIds = [
  ...paginationCustomerIds,
  ...paginationExcludedCustomerIds,
];
const paginationReservationIds = paginationTestCustomerIds.map(
  (customerId) => `reservation-${customerId}`
);

const insertReservation = (
  postgres: WorkspacePostgresTestDatabase,
  id: string,
  customerId: string,
  updatedAt?: Temporal.Instant
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
      ...(updatedAt && { updatedAt }),
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

const deleteSyntheticData = async (
  postgres: WorkspacePostgresTestDatabase,
  customerIds: readonly string[],
  reservationIds: readonly string[]
) => {
  await Effect.runPromise(
    postgres.db
      .delete(workspaceReservations)
      .where(inArray(workspaceReservations.id, reservationIds))
  );
  await Effect.runPromise(
    postgres.db
      .delete(customerMarketingConsents)
      .where(inArray(customerMarketingConsents.dotyposCustomerId, customerIds))
  );
};

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

    const seedPaginationData = async () => {
      for (const customerId of paginationCustomerIds) {
        await insertReservation(
          postgres,
          `reservation-${customerId}`,
          customerId,
          paginationSortInstant
        );
        await insertConsent(postgres, customerId, null);
      }
      await insertReservation(
        postgres,
        "reservation-pagination-withdrawn",
        "pagination-withdrawn",
        paginationSortInstant
      );
      await insertReservation(
        postgres,
        "reservation-pagination-never",
        "pagination-never",
        paginationSortInstant
      );
      await insertConsent(postgres, "pagination-withdrawn", withdrawnAt);
    };

    test("Granted matches only an active grant, never a withdrawn grant or a missing consent row", async () => {
      try {
        await seedMixedConsentData();
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
        await deleteSyntheticData(
          postgres,
          mixedConsentCustomerIds,
          mixedConsentReservationIds
        );
      }
    });

    test("Withdrawn matches only withdrawn grants and Never matches only missing consent rows", async () => {
      try {
        await seedMixedConsentData();
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
        await deleteSyntheticData(
          postgres,
          mixedConsentCustomerIds,
          mixedConsentReservationIds
        );
      }
    });

    test("paginates 26 granted customers in stable order without withdrawn or missing rows", async () => {
      try {
        await seedPaginationData();
        const administration = await makeService();

        const firstPage = await Effect.runPromise(
          administration.listCustomers({
            marketingConsent: "granted",
            page: 1,
          } satisfies AdministrationCustomerListInput)
        );
        const secondPage = await Effect.runPromise(
          administration.listCustomers({
            marketingConsent: "granted",
            page: 2,
          } satisfies AdministrationCustomerListInput)
        );
        const firstPageIds = firstPage.items.map((item) => item.customerId);
        const secondPageIds = secondPage.items.map((item) => item.customerId);
        const pagedCustomerIds = [...firstPageIds, ...secondPageIds];

        expect(firstPage.total).toBe(paginationCustomerIds.length);
        expect(firstPage.page).toBe(1);
        expect(firstPage.pageCount).toBe(2);
        expect(secondPage.total).toBe(paginationCustomerIds.length);
        expect(secondPage.page).toBe(2);
        expect(secondPage.pageCount).toBe(2);
        expect(firstPageIds).toEqual(paginationCustomerIds.slice(0, 24));
        expect(secondPageIds).toEqual(paginationCustomerIds.slice(24));
        expect(new Set(pagedCustomerIds).size).toBe(
          paginationCustomerIds.length
        );
        expect(pagedCustomerIds).not.toContain("pagination-withdrawn");
        expect(pagedCustomerIds).not.toContain("pagination-never");
        expect(
          [...firstPage.items, ...secondPage.items].every(
            (item) => item.marketingConsent === "granted"
          )
        ).toBe(true);
      } finally {
        await deleteSyntheticData(
          postgres,
          paginationTestCustomerIds,
          paginationReservationIds
        );
      }
    });
  }
);
