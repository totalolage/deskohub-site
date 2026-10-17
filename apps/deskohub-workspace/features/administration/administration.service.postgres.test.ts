import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import {
  type FulfillmentState,
  paymentAttempts,
  type ReservationState,
  workspaceReservations,
} from "@/db/schema";
import {
  checkoutAttemptKeySchema,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type AdministrationCustomerListInput,
  AdministrationService,
} from "./administration.service";
import { PaymentAdministrationServiceMock } from "./payment-administration.service.mock";
import { PostHogReservationHistory } from "./posthog-reservation-history";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "AdministrationService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];
    const runId = crypto.randomUUID();
    const makeCustomerId = (role: string) =>
      DotyposCustomerIdSchema.make(`${role}-customer-${runId}`);

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
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
                  testDatabase.layer,
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

    const insertReservation = async ({
      customerId,
      fulfillmentState,
      label,
      reservationState,
      updatedAt,
    }: {
      readonly customerId: DotyposCustomerId;
      readonly fulfillmentState: Exclude<FulfillmentState, "awaiting_delivery">;
      readonly label: string;
      readonly reservationState: ReservationState;
      readonly updatedAt?: Temporal.Instant;
    }) => {
      const id = `${label}-${runId}`;
      const reservationId = workspaceReservationIdSchema.make(`admin-${id}`);
      reservationIds.push(reservationId);
      const now = Temporal.Now.instant();
      await Effect.runPromise(
        testDatabase.db.insert(workspaceReservations).values({
          id: reservationId,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(`attempt-${id}`),
          dotyposCustomerId: customerId,
          dotyposReservationId: DotyposReservationIdSchema.make(
            `booking-${id}`
          ),
          reservationState,
          paymentState: "paid",
          paidAt: now,
          fulfillmentState,
          ...(fulfillmentState === "fulfilled" && { fulfilledAt: now }),
          ...(fulfillmentState === "failed" && {
            fulfillmentFailedAt: now,
            fulfillmentFailureCode: "fulfillment_dotypos_failed",
          }),
          reservationDetails: {
            kind: "cowork",
            entryTier: "open-space",
            coffee: false,
          },
          locale: "en-US",
          ...(updatedAt && { updatedAt }),
        })
      );
      return reservationId;
    };

    describe("successful reservations", () => {
      // A reservation succeeds once it is fulfilled and not cancelled. Every
      // other state below is unsuccessful, including fulfilled cancellations.
      const unsuccessfulStates = [
        ["cancelled", "fulfilled"],
        ["cancelling", "fulfilled"],
        ["cancellation_failed", "fulfilled"],
        ["confirmed", "failed"],
        ["confirmed", "processing"],
        ["confirmed", "not_started"],
        ["hold_expired", "not_started"],
      ] as const;
      const frequent = makeCustomerId("frequent");
      const mixed = makeCustomerId("mixed");
      const unsuccessful = makeCustomerId("unsuccessful");
      const seededCustomers = new Set<string>([frequent, mixed, unsuccessful]);
      const successfulIds = new Map<DotyposCustomerId, string[]>();
      const lastActivityAt = new Map<DotyposCustomerId, string>();

      /**
       * Seeds one customer's reservations. Their unsuccessful rows outnumber
       * the successful ones, so a plain row count would reverse the order.
       */
      const seedCustomer = async (
        customerId: DotyposCustomerId,
        successfulCount: number,
        unsuccessfulRows: readonly (readonly [
          ReservationState,
          Exclude<FulfillmentState, "awaiting_delivery">,
        ])[],
        latestActivity: Temporal.Instant
      ) => {
        lastActivityAt.set(customerId, latestActivity.toString());
        const ids: string[] = [];
        for (let index = 0; index < successfulCount; index += 1) {
          ids.push(
            await insertReservation({
              customerId,
              label: `${customerId}-successful-${index}`,
              reservationState: "confirmed",
              fulfillmentState: "fulfilled",
              updatedAt: latestActivity.subtract({ hours: index + 1 }),
            })
          );
        }
        successfulIds.set(customerId, ids.sort());
        for (const [
          index,
          [reservationState, fulfillmentState],
        ] of unsuccessfulRows.entries()) {
          await insertReservation({
            customerId,
            label: `${customerId}-${reservationState}-${fulfillmentState}`,
            reservationState,
            fulfillmentState,
            // The first unsuccessful row carries the customer's latest activity.
            updatedAt: latestActivity.subtract({ minutes: index }),
          });
        }
      };

      beforeAll(async () => {
        await seedCustomer(
          frequent,
          2,
          [["cancelled", "fulfilled"]],
          Temporal.Instant.from("2099-01-01T00:00:00Z")
        );
        await seedCustomer(
          mixed,
          1,
          unsuccessfulStates,
          Temporal.Instant.from("2099-01-03T00:00:00Z")
        );
        await seedCustomer(
          unsuccessful,
          0,
          unsuccessfulStates,
          Temporal.Instant.from("2099-01-02T00:00:00Z")
        );
      });

      /** Lists every customer page and keeps only this run's customers. */
      const listSeededCustomers = async (
        input: AdministrationCustomerListInput
      ) => {
        const items = [];
        for (let page = 1; ; page += 1) {
          const result = await run((administration) =>
            administration.listCustomers({ ...input, page })
          );
          items.push(
            ...result.items.filter(({ customerId }) =>
              seededCustomers.has(customerId)
            )
          );
          if (page >= result.pageCount) return items;
        }
      };

      test("counts and sorts customers by successful reservations only", async () => {
        const byReservations = await listSeededCustomers({
          sort: "reservations",
        });
        expect(
          byReservations.map(({ customerId, reservationCount }) => [
            customerId,
            reservationCount,
          ])
        ).toEqual([
          [frequent, 2],
          [mixed, 1],
          [unsuccessful, 0],
        ]);

        const ascending = await listSeededCustomers({
          sort: "reservations",
          direction: "asc",
        });
        expect(ascending.map(({ customerId }) => customerId)).toEqual([
          unsuccessful,
          mixed,
          frequent,
        ]);

        const byActivity = await listSeededCustomers({});
        expect(
          byActivity.map(({ customerId, lastActivityAt }) => [
            customerId,
            lastActivityAt,
          ])
        ).toEqual(
          [mixed, unsuccessful, frequent].map((customerId) => [
            customerId,
            lastActivityAt.get(customerId),
          ])
        );
      });

      test("counts only successful reservations in customer stats but lists every reservation", async () => {
        for (const [customerId, reservationCount, historyLength] of [
          [frequent, 2, 3],
          [mixed, 1, 1 + unsuccessfulStates.length],
          [unsuccessful, 0, unsuccessfulStates.length],
        ] as const) {
          const activity = await run((administration) =>
            administration.loadCustomerActivity(customerId)
          );
          expect(activity.stats.reservationCount).toBe(reservationCount);
          expect(activity.reservations).toHaveLength(historyLength);
        }
      });

      test("filters the Complete status to successful reservations", async () => {
        for (const customerId of [frequent, mixed, unsuccessful]) {
          const complete = await run((administration) =>
            administration.listReservations({
              customerId,
              status: "complete",
            })
          );
          expect(complete.total).toBe(
            successfulIds.get(customerId)?.length ?? 0
          );
          expect(complete.items.map(({ id }) => id).sort()).toEqual(
            successfulIds.get(customerId) ?? []
          );
        }
      });
    });

    test("counts only the amount kept after refunds as customer revenue", async () => {
      const customerId = makeCustomerId("revenue");
      const payments = [
        { label: "refunded", amountValue: 39_000, refundedAmountValue: 39_000 },
        { label: "partial", amountValue: 45_000, refundedAmountValue: 15_000 },
        { label: "kept", amountValue: 35_000, refundedAmountValue: null },
      ] as const;
      for (const { label, amountValue, refundedAmountValue } of payments) {
        const reservationId = await insertReservation({
          customerId,
          label: `revenue-${label}`,
          reservationState: "confirmed",
          fulfillmentState: "fulfilled",
        });
        const id = `revenue-${label}-${runId}`;
        await Effect.runPromise(
          testDatabase.db.insert(paymentAttempts).values({
            id: paymentAttemptIdSchema.make(`attempt-${id}`),
            workspaceReservationId: reservationId,
            provider: "nexi",
            providerOrderId: NexiOrderIdSchema.make(`order-${id}`),
            state: "paid",
            amountValue,
            amountExponent: 2,
            currency: "CZK",
            ...(refundedAmountValue === null
              ? { refundState: "not_required" }
              : {
                  refundState: "refunded",
                  refundedAmountValue,
                  refundedAt: Temporal.Instant.from("2026-10-11T12:00:00Z"),
                }),
          })
        );
      }

      const activity = await run((administration) =>
        administration.loadCustomerActivity(customerId)
      );

      expect(activity.stats.revenue).toEqual([
        { value: 65_000, exponent: 2, currency: "CZK" },
      ]);
      // The Admin UI names products from these codes in the operator's language.
      expect(activity.stats.favoriteReservationProduct).toEqual({
        kind: "cowork",
        tier: "open-space",
      });
      expect(
        activity.transactions.map(({ reservation }) => reservation.product)
      ).toEqual(payments.map(() => ({ kind: "cowork", tier: "open-space" })));
    });

    describe("refund attention", () => {
      const customerId = makeCustomerId("refund");

      /** Inserts a paid, cancelled checkout with one attempt per refund state. */
      const insertPaidCheckout = async (
        label: string,
        refundStates: readonly ("not_required" | "required" | "refunded")[]
      ) => {
        const reservationId = await insertReservation({
          customerId,
          label: `refund-${label}`,
          reservationState: "cancelled",
          fulfillmentState: "not_started",
        });
        const id = `${label}-${runId}`;
        for (const [index, refundState] of refundStates.entries()) {
          await Effect.runPromise(
            testDatabase.db.insert(paymentAttempts).values({
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
    });
  }
);
