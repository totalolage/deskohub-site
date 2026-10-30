import {
  seededCustomerReads,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { IgloohomeDeviceIdSchema } from "@deskohub/igloohome";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { Effect, Layer, Option } from "effect";
import {
  customerMarketingConsents,
  type FulfillmentState,
  paymentAttempts,
  type ReservationState,
  reservationAccessGrants,
} from "@/db/schema";
import { ReservationAuthorDirectory } from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import {
  type StoredWorkspaceReservationDetails,
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  fixtureReservationAuthorId,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type AdministrationCustomerExportInput,
  type AdministrationCustomerListInput,
  type AdministrationReservationExportInput,
  AdministrationService,
} from "./administration.service";
import { PaymentAdministrationServiceMock } from "./payment-administration.service.mock";
import { PostHogReservationHistory } from "./posthog-reservation-history";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const openSpaceDetails = {
  kind: "cowork",
  entryTier: "open-space",
  coffee: false,
} as const;

type DotyposServiceOverrides = NonNullable<
  Parameters<typeof DotyposServiceMock>[0]
>;

describe.skipIf(!testDatabase)(
  "AdministrationService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];
    const runId = crypto.randomUUID();
    const makeCustomerId = (role: string) =>
      DotyposCustomerIdSchema.make(`${role}-customer-${runId}`);
    const bookingId = (label: string) =>
      DotyposReservationIdSchema.make(`booking-${label}-${runId}`);
    const authorCustomerId = makeCustomerId("author");
    const accountIds: CustomerAccountId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from reservation_access_grants where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id like $1",
        [`%-customer-${runId}`]
      );
      await testDatabase.pool.query(
        `delete from auth."user" where id = any($1)`,
        [accountIds]
      );
      await testDatabase.pool.query(
        "delete from customer_accounts where id = any($1)",
        [accountIds]
      );
    });

    const run = <A, E>(
      operation: (
        administration: typeof AdministrationService.Service
      ) => Effect.Effect<A, E>,
      {
        listReservations = () => Effect.succeed([]),
      }: Pick<DotyposServiceOverrides, "listReservations"> = {}
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
                    getCustomer: () => Effect.succeed(Option.none()),
                    getCustomersByIds: (ids) =>
                      Effect.succeed(
                        ids?.includes(authorCustomerId)
                          ? [
                              {
                                id: authorCustomerId,
                                firstName: "Ada",
                                lastName: "Author",
                              },
                            ]
                          : []
                      ).pipe(
                        Effect.flatMap((records) =>
                          seededCustomerReads(records).getCustomersByIds(ids)
                        )
                      ),
                    getTables: () => Effect.succeed([]),
                    listReservations,
                    getReservationsByIds: (ids, options) =>
                      listReservations({ ...options, ids: [...ids] }).pipe(
                        Effect.flatMap((records) =>
                          seededReservationReads(records).getReservationsByIds(
                            ids
                          )
                        )
                      ),
                  }),
                  Layer.succeed(
                    PostHogReservationHistory,
                    PostHogReservationHistory.of({
                      load: () =>
                        Effect.succeed({ kind: "unavailable" } as const),
                    })
                  ),
                  PaymentAdministrationServiceMock({
                    loadReservationOrders: () => Effect.succeed([]),
                  }),
                  ReservationAuthorDirectory.Default.pipe(
                    Layer.provide(testDatabase.layer)
                  )
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
      const { id } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: {
            reservation: reservationState,
            payment: "paid",
            fulfillment: fulfillmentState,
          },
          customer: customerId,
          details: openSpaceDetails,
          overrides: {
            dotyposReservationId: bookingId(label),
            ...(updatedAt && { updatedAt }),
          },
        })
      );
      reservationIds.push(id);
      return id;
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

    describe("customer list filters", () => {
      const range = { from: "2026-10-01", to: "2026-10-31" } as const;
      const booking = (label: string) => ({
        _branchId: "branch",
        _cloudId: "cloud",
        _customerId: "dotypos-customer",
        endDate: "2026-10-10T10:00:00Z",
        id: bookingId(label),
        seats: "1",
        startDate: "2026-10-10T08:00:00Z",
        status: "CONFIRMED" as const,
      });
      const twice = makeCustomerId("filter-twice");
      const unsuccessfulInRange = makeCustomerId("filter-unsuccessful");
      const outOfRange = makeCustomerId("filter-out-of-range");
      const withdrawn = makeCustomerId("filter-withdrawn");
      const never = makeCustomerId("filter-never");
      const seededCustomers = new Set<string>([
        twice,
        unsuccessfulInRange,
        outOfRange,
        withdrawn,
        never,
      ]);
      const inRangeLabels: string[] = [];
      const withdrawnLatestActivity = Temporal.Instant.from(
        "2098-06-01T00:00:00Z"
      );

      const seed = async ({
        customerId,
        fulfillmentState = "fulfilled",
        inRange,
        label,
        reservationState = "confirmed",
        updatedAt,
      }: {
        readonly customerId: DotyposCustomerId;
        readonly fulfillmentState?: Exclude<
          FulfillmentState,
          "awaiting_delivery"
        >;
        readonly inRange: boolean;
        readonly label: string;
        readonly reservationState?: ReservationState;
        readonly updatedAt?: Temporal.Instant;
      }) => {
        await insertReservation({
          customerId,
          fulfillmentState,
          label,
          reservationState,
          updatedAt,
        });
        if (inRange) inRangeLabels.push(label);
      };

      const grantConsent = (
        dotyposCustomerId: DotyposCustomerId,
        withdrawnAt?: Temporal.Instant
      ) =>
        Effect.runPromise(
          testDatabase.db.insert(customerMarketingConsents).values({
            dotyposCustomerId,
            documentHash: "hash",
            locale: "cs-CZ",
            grantedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
            ...(withdrawnAt && { withdrawnAt }),
          })
        );

      beforeAll(async () => {
        await seed({ customerId: twice, inRange: true, label: "twice-1" });
        await seed({ customerId: twice, inRange: true, label: "twice-2" });
        await grantConsent(twice);
        // Its only booking in the range was cancelled.
        await seed({
          customerId: unsuccessfulInRange,
          fulfillmentState: "fulfilled",
          inRange: true,
          label: "unsuccessful-cancelled",
          reservationState: "cancelled",
        });
        await seed({
          customerId: unsuccessfulInRange,
          inRange: false,
          label: "unsuccessful-elsewhere",
        });
        await grantConsent(
          unsuccessfulInRange,
          Temporal.Instant.from("2026-02-01T00:00:00Z")
        );
        await seed({
          customerId: outOfRange,
          inRange: false,
          label: "out-of-range",
        });
        await seed({
          customerId: withdrawn,
          inRange: true,
          label: "withdrawn-in-range",
        });
        // Outside the range, but still part of the customer's aggregates.
        await seed({
          customerId: withdrawn,
          inRange: false,
          label: "withdrawn-elsewhere",
          updatedAt: withdrawnLatestActivity,
        });
        await grantConsent(
          withdrawn,
          Temporal.Instant.from("2026-03-01T00:00:00Z")
        );
        await seed({ customerId: never, inRange: true, label: "absent" });
      });

      const listInRange = (
        input: AdministrationCustomerListInput,
        bookings = inRangeLabels.map(booking)
      ) =>
        run((administration) => administration.listCustomers(input), {
          listReservations: () => Effect.succeed(bookings),
          getReservationsByIds: (ids) =>
            Effect.succeed(bookings).pipe(
              Effect.flatMap((records) =>
                seededReservationReads(records).getReservationsByIds(ids)
              )
            ),
        });

      /** Lists every customer page and keeps only this suite's customers. */
      const listSeeded = async (input: AdministrationCustomerListInput) => {
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

      test("keeps customers with a successful reservation starting in the range, once each", async () => {
        const listInputs: unknown[] = [];
        const result = await run(
          (administration) => administration.listCustomers(range),
          {
            listReservations: (input) =>
              Effect.sync(() => {
                listInputs.push(input);
                return inRangeLabels.map(booking);
              }),
            getReservationsByIds: (ids, readOptions) => {
              const input = { ...readOptions, ids: [...ids] };
              return Effect.sync(() => {
                listInputs.push(input);
                return inRangeLabels.map(booking);
              }).pipe(
                Effect.flatMap((records) =>
                  seededReservationReads(records).getReservationsByIds(ids)
                )
              );
            },
          }
        );

        expect(listInputs).toEqual([
          {
            order: "startDateAscending",
            // Early setup holds a midnight booking from the date before.
            startsAtOrAfter: "2026-09-30T21:45:00Z",
            startsBefore: "2026-10-31T23:00:00Z",
          },
        ]);
        expect(result.dateFilterUnavailable).toBe(false);
        expect(result.total).toBe(3);
        expect(result.pageCount).toBe(1);
        expect(result.items.map(({ customerId }) => customerId).sort()).toEqual(
          [never, twice, withdrawn].sort()
        );
        // The range decides membership; the aggregates keep full history.
        const withdrawnItem = result.items.find(
          ({ customerId }) => customerId === withdrawn
        );
        expect(withdrawnItem?.reservationCount).toBe(2);
        expect(withdrawnItem?.lastActivityAt).toBe(
          withdrawnLatestActivity.toString()
        );
        expect(
          result.items.find(({ customerId }) => customerId === twice)
            ?.reservationCount
        ).toBe(2);
      });

      test("normalizes a reversed range", async () => {
        const result = await listInRange({ from: range.to, to: range.from });
        expect(result.total).toBe(3);
      });

      test("counts only bookings successful in Deskohub and not cancelled in Dotypos", async () => {
        const dotyposCancelled = makeCustomerId("filter-dotypos-cancelled");
        // Deskohub records it as fulfilled, whatever Dotypos reports.
        await insertReservation({
          customerId: dotyposCancelled,
          fulfillmentState: "fulfilled",
          label: "dotypos-cancelled",
          reservationState: "confirmed",
        });
        const bookings = (status: "CANCELLED" | "CONFIRMED" | "NEW") =>
          [...inRangeLabels, "dotypos-cancelled"].map((label) => ({
            ...booking(label),
            ...((label === "dotypos-cancelled" || label === "twice-1") && {
              status,
            }),
          }));
        const customerIds = (items: readonly { customerId: string }[]) =>
          items.map(({ customerId }) => customerId).sort();

        const cancelled = await listInRange(range, bookings("CANCELLED"));
        // `twice` still has a booking Dotypos kept; the locally cancelled
        // booking of `unsuccessfulInRange` never counts.
        expect(customerIds(cancelled.items)).toEqual(
          [never, twice, withdrawn].sort()
        );
        expect(cancelled.total).toBe(3);
        expect(
          customerIds(
            await run(
              (administration) => administration.exportCustomers(range),
              {
                listReservations: () => Effect.succeed(bookings("CANCELLED")),
                getReservationsByIds: (ids) =>
                  Effect.succeed(bookings("CANCELLED")).pipe(
                    Effect.flatMap((records) =>
                      seededReservationReads(records).getReservationsByIds(ids)
                    )
                  ),
              }
            )
          )
        ).toEqual(customerIds(cancelled.items));

        for (const status of ["CONFIRMED", "NEW"] as const) {
          const kept = await listInRange(range, bookings(status));
          expect(customerIds(kept.items)).toEqual(
            [dotyposCancelled, never, twice, withdrawn].sort()
          );
          expect(kept.total).toBe(4);
        }
      });

      test("filters by a range holding more bookings than Postgres's parameter limit", async () => {
        const bookings = [
          ...Array.from({ length: 70_000 }, (_, index) =>
            booking(`filter-unlinked-${index}`)
          ),
          ...inRangeLabels.map(booking),
        ];
        const result = await listInRange(range, bookings);
        expect(result.total).toBe(3);
        expect(result.items.map(({ customerId }) => customerId).sort()).toEqual(
          [never, twice, withdrawn].sort()
        );
      });

      test("filters by current marketing consent and projects it", async () => {
        const states = async (
          marketingConsent?: AdministrationCustomerListInput["marketingConsent"]
        ) =>
          (await listSeeded({ marketingConsent }))
            .map(({ customerId, marketingConsent }) => [
              customerId,
              marketingConsent,
            ])
            .sort();

        expect(await states("active")).toEqual([[twice, "active"]]);
        expect(await states("withdrawn")).toEqual(
          [
            [unsuccessfulInRange, "withdrawn"],
            [withdrawn, "withdrawn"],
          ].sort()
        );
        expect(await states("absent")).toEqual(
          [
            [never, "absent"],
            [outOfRange, "absent"],
          ].sort()
        );
        expect(await states()).toEqual(
          [
            [never, "absent"],
            [outOfRange, "absent"],
            [twice, "active"],
            [unsuccessfulInRange, "withdrawn"],
            [withdrawn, "withdrawn"],
          ].sort()
        );
      });

      test("combines the date range with the consent filter", async () => {
        for (const [marketingConsent, expected] of [
          ["active", twice],
          ["withdrawn", withdrawn],
          ["absent", never],
        ] as const) {
          const result = await listInRange({ ...range, marketingConsent });
          expect(result.total).toBe(1);
          expect(result.items.map(({ customerId }) => customerId)).toEqual([
            expected,
          ]);
        }
      });

      test("selects no customers when Dotypos can't answer the range", async () => {
        const result = await run(
          (administration) =>
            administration.listCustomers({
              ...range,
              marketingConsent: "absent",
            }),
          {
            listReservations: () =>
              Effect.fail(
                new DotyposUnavailable({
                  operation: "listReservations",
                  reason: "server",
                })
              ),
            getReservationsByIds: (ids) =>
              Effect.fail(
                new DotyposUnavailable({
                  operation: "listReservations",
                  reason: "server",
                })
              ).pipe(
                Effect.flatMap((records) =>
                  seededReservationReads(records).getReservationsByIds(ids)
                )
              ),
          }
        );
        expect(result).toEqual({
          dateFilterUnavailable: true,
          items: [],
          page: 1,
          pageCount: 1,
          total: 0,
        });
      });

      describe("export", () => {
        const exportInRange = (
          input: AdministrationCustomerExportInput,
          bookings = inRangeLabels.map(booking)
        ) =>
          run((administration) => administration.exportCustomers(input), {
            listReservations: () => Effect.succeed(bookings),
            getReservationsByIds: (ids) =>
              Effect.succeed(bookings).pipe(
                Effect.flatMap((records) =>
                  seededReservationReads(records).getReservationsByIds(ids)
                )
              ),
          });

        test("exports the customers the list shows under each filter", async () => {
          for (const marketingConsent of [
            undefined,
            "active",
            "withdrawn",
            "absent",
          ] as const) {
            const exported = await run((administration) =>
              administration.exportCustomers({ marketingConsent })
            );
            expect(
              exported.filter(({ customerId }) =>
                seededCustomers.has(customerId)
              )
            ).toEqual(await listSeeded({ marketingConsent }));

            const exportedInRange = await exportInRange({
              ...range,
              marketingConsent,
            });
            expect(exportedInRange).toEqual(
              (await listInRange({ ...range, marketingConsent })).items
            );
          }
        });

        test("fails instead of exporting no customers when Dotypos can't answer the range", async () => {
          const failure = await run(
            (administration) =>
              administration.exportCustomers(range).pipe(Effect.flip),
            {
              listReservations: () =>
                Effect.fail(
                  new DotyposUnavailable({
                    operation: "listReservations",
                    reason: "server",
                  })
                ),
              getReservationsByIds: (ids) =>
                Effect.fail(
                  new DotyposUnavailable({
                    operation: "listReservations",
                    reason: "server",
                  })
                ).pipe(
                  Effect.flatMap((records) =>
                    seededReservationReads(records).getReservationsByIds(ids)
                  )
                ),
            }
          );
          expect(failure).toMatchObject({
            _tag: "AdministrationListSourceUnavailableError",
            source: "booking-dates",
          });
        });
      });

      test("doesn't read Dotypos without a range", async () => {
        const result = await run(
          (administration) =>
            administration.listCustomers({ marketingConsent: "active" }),
          {
            listReservations: () =>
              Effect.die(new Error("Dotypos must not be read")),
            getReservationsByIds: (ids) =>
              Effect.die(new Error("Dotypos must not be read")).pipe(
                Effect.flatMap((records) =>
                  seededReservationReads(records).getReservationsByIds(ids)
                )
              ),
          }
        );
        expect(result.dateFilterUnavailable).toBe(false);
      });

      describe("paging", () => {
        // More customers than one page holds, each with a successful booking
        // in the range and 1–3 successful reservations in total.
        const pagedCustomers = Array.from({ length: 26 }, (_, index) => ({
          customerId: makeCustomerId(
            `filter-page-${String(index).padStart(2, "0")}`
          ),
          reservationCount: 1 + (index % 3),
          lastActivityAt: Temporal.Instant.from("2097-01-01T00:00:00Z").add({
            hours: (index * 7) % 26,
          }),
        }));
        const pagedLabels: string[] = [];

        beforeAll(async () => {
          for (const customer of pagedCustomers) {
            for (let index = 0; index < customer.reservationCount; index += 1) {
              const label = `${customer.customerId}-${index}`;
              await insertReservation({
                customerId: customer.customerId,
                fulfillmentState: "fulfilled",
                label,
                reservationState: "confirmed",
                updatedAt: customer.lastActivityAt.subtract({ minutes: index }),
              });
              if (index === 0) pagedLabels.push(label);
            }
          }
        });

        const listAllPages = async (input: AdministrationCustomerListInput) => {
          const pages = [];
          for (let page = 1; ; page += 1) {
            const result = await listInRange(
              { ...range, ...input, page },
              pagedLabels.map(booking)
            );
            pages.push(result);
            if (page >= result.pageCount) return pages;
          }
        };

        test("counts, pages and sorts the filtered set", async () => {
          const byCustomerId = (
            left: (typeof pagedCustomers)[number],
            right: (typeof pagedCustomers)[number]
          ) => left.customerId.localeCompare(right.customerId);
          for (const [input, expected] of [
            [
              {},
              pagedCustomers.toSorted(
                (left, right) =>
                  Temporal.Instant.compare(
                    right.lastActivityAt,
                    left.lastActivityAt
                  ) || byCustomerId(left, right)
              ),
            ],
            [
              { sort: "reservations", direction: "asc" },
              pagedCustomers.toSorted(
                (left, right) =>
                  left.reservationCount - right.reservationCount ||
                  byCustomerId(left, right)
              ),
            ],
            [
              { sort: "reservations", direction: "desc" },
              pagedCustomers.toSorted(
                (left, right) =>
                  right.reservationCount - left.reservationCount ||
                  byCustomerId(left, right)
              ),
            ],
          ] as const) {
            const pages = await listAllPages(input);
            expect(
              pages.map(({ total, pageCount }) => [total, pageCount])
            ).toEqual([
              [26, 2],
              [26, 2],
            ]);
            expect(pages.map(({ items }) => items.length)).toEqual([24, 2]);
            expect(
              pages.flatMap(({ items }) =>
                items.map(({ customerId, reservationCount }) => [
                  customerId,
                  reservationCount,
                ])
              )
            ).toEqual(
              expected.map(({ customerId, reservationCount }) => [
                customerId,
                reservationCount,
              ])
            );
          }
        });

        test("exports every customer of the filtered set in list order, without pages", async () => {
          for (const input of [
            {},
            { sort: "reservations", direction: "asc" },
            { sort: "activity", direction: "asc" },
          ] as const) {
            const pages = await listAllPages(input);
            const exported = await run(
              (administration) =>
                administration.exportCustomers({ ...range, ...input }),
              {
                listReservations: () =>
                  Effect.succeed(pagedLabels.map(booking)),
                getReservationsByIds: (ids) =>
                  Effect.succeed(pagedLabels.map(booking)).pipe(
                    Effect.flatMap((records) =>
                      seededReservationReads(records).getReservationsByIds(ids)
                    )
                  ),
              }
            );
            expect(exported).toHaveLength(26);
            expect(exported).toEqual(pages.flatMap(({ items }) => items));
          }
        });
      });
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

    describe("reservation author", () => {
      const insertAccount = async (linkedCustomer: DotyposCustomerId) => {
        const account = await Effect.runPromise(
          workspaceFixtures(testDatabase.db).account("admin-author", {
            linkedCustomer,
          })
        );
        accountIds.push(account.accountId);
        return account;
      };

      const insertAuthoredReservation = async (
        customerId: DotyposCustomerId,
        author: CustomerAccountId
      ) => {
        const { id } = await Effect.runPromise(
          workspaceFixtures(testDatabase.db).reservation({
            stage: { reservation: "draft" },
            customer: customerId,
            author,
          })
        );
        reservationIds.push(id);
        return id;
      };

      test("names an author who booked for someone else and omits the customer's own", async () => {
        const customerId = makeCustomerId("booked-for");
        const author = await insertAccount(authorCustomerId);
        const own = await insertAccount(customerId);
        const bookedForSomeoneElse = await insertAuthoredReservation(
          customerId,
          author.accountId
        );
        const bookedForThemselves = await insertAuthoredReservation(
          customerId,
          own.accountId
        );

        const [other, self] = await Promise.all(
          [bookedForSomeoneElse, bookedForThemselves].map((id) =>
            run((administration) => administration.loadReservation(id))
          )
        );

        expect(other?.author).toEqual({
          kind: "account",
          customerId: authorCustomerId,
          displayName: "Ada Author",
          hasName: true,
          email: author.email,
        });
        expect(self?.author).toBeNull();
      });
    });

    test("shows the access name stored on the grant, or the reservation-built name of a grant created before names were stored", async () => {
      const insertGrant = async (
        label: string,
        values: Pick<
          typeof reservationAccessGrants.$inferInsert,
          "state" | "accessName" | "failureCode" | "provisioningStartedAt"
        >
      ) => {
        // Without a Dotypos booking, the detail loads from Neon alone.
        const { id: reservationId } = await Effect.runPromise(
          workspaceFixtures(testDatabase.db).reservation({
            stage: { reservation: "draft" },
            customer: makeCustomerId(label),
          })
        );
        reservationIds.push(reservationId);
        const startsAt = Temporal.Instant.from("2099-07-01T08:00:00Z");
        const [grant] = await Effect.runPromise(
          testDatabase.db
            .insert(reservationAccessGrants)
            .values({
              workspaceReservationId: reservationId,
              deviceId: IgloohomeDeviceIdSchema.make("EK1"),
              ...values,
              scheduledAccessStartsAt: startsAt,
              accessStartsAt: startsAt,
              accessEndsAt: startsAt.add({ hours: 8 }),
            })
            .returning({ id: reservationAccessGrants.id })
        );
        return { reservationId, grantId: grant?.id };
      };
      const stored = await insertGrant("access-stored", {
        state: "uncertain",
        accessName: "Deskohub stored-name",
        failureCode: "provider_outcome_ambiguous",
      });
      // A deployment that predates stored names created these grants.
      const legacyPending = await insertGrant("access-legacy-pending", {
        state: "pending",
        accessName: null,
      });
      const legacyUncertain = await insertGrant("access-legacy-uncertain", {
        state: "uncertain",
        accessName: null,
        failureCode: "provider_outcome_ambiguous",
      });
      const legacyStaleProvisioning = await insertGrant(
        "access-legacy-provisioning",
        {
          state: "provisioning",
          accessName: null,
          provisioningStartedAt: Temporal.Now.instant().subtract({
            hours: 1,
          }),
        }
      );

      const [
        storedDetail,
        legacyPendingDetail,
        legacyUncertainDetail,
        legacyStaleProvisioningDetail,
      ] = await Promise.all(
        [stored, legacyPending, legacyUncertain, legacyStaleProvisioning].map(
          ({ reservationId }) =>
            run((administration) =>
              administration.loadReservation(reservationId)
            )
        )
      );

      expect(storedDetail?.accessGrant?.accessName).toBe(
        "Deskohub stored-name"
      );
      expect(legacyPendingDetail?.accessGrant?.accessName).toBe(
        `Deskohub ${legacyPending.reservationId}`.slice(0, 60)
      );
      expect(legacyUncertainDetail?.accessGrant?.accessName).toBe(
        `Deskohub ${legacyUncertain.reservationId}`.slice(0, 60)
      );
      expect(legacyStaleProvisioningDetail?.accessGrant?.accessName).toBe(
        `Deskohub ${legacyStaleProvisioning.reservationId}`.slice(0, 60)
      );
    });

    describe("reservation export", () => {
      test("exports every reservation the list filters match, in list order", async () => {
        const customerId = makeCustomerId("export");
        const otherCustomerId = makeCustomerId("export-other");
        const complete: WorkspaceReservationId[] = [];
        for (let index = 0; index < 30; index += 1) {
          complete.push(
            await insertReservation({
              customerId,
              fulfillmentState: "fulfilled",
              label: `export-complete-${index}`,
              reservationState: "confirmed",
            })
          );
        }
        const cancelled = await insertReservation({
          customerId,
          fulfillmentState: "fulfilled",
          label: "export-cancelled",
          reservationState: "cancelled",
        });
        await insertReservation({
          customerId: otherCustomerId,
          fulfillmentState: "fulfilled",
          label: "export-other-customer",
          reservationState: "confirmed",
        });
        const input = {
          customerId,
          direction: "asc",
          sort: "created",
          status: "complete",
          type: "cowork",
        } as const;

        const [exported, firstPage, secondPage, otherType] = await Promise.all([
          run((administration) => administration.exportReservations(input)),
          run((administration) =>
            administration.listReservations({ ...input, page: 1 })
          ),
          run((administration) =>
            administration.listReservations({ ...input, page: 2 })
          ),
          run((administration) =>
            administration.exportReservations({
              ...input,
              type: "meeting-room",
            })
          ),
        ]);

        expect(exported.map(({ id }) => id)).toEqual(
          [...firstPage.items, ...secondPage.items].map(({ id }) => id)
        );
        expect(exported).toHaveLength(30);
        expect(exported.map(({ id }) => id).sort()).toEqual(complete.sort());
        expect(exported.map(({ id }) => id)).not.toContain(cancelled);
        expect(otherType).toEqual([]);
        // Dotypos returned neither the bookings nor the customer, which an
        // export keeps as empty details instead of failing.
        expect(exported[0]?.customer).toBeNull();
        expect(exported[0]?.startsAt).toBeNull();
        expect(exported[0]?.dotyposReservationId).toBe(
          DotyposReservationIdSchema.make(`booking-export-complete-0-${runId}`)
        );
      });

      test("exports more reservations than Postgres's parameter limit, in date order", async () => {
        const customerId = makeCustomerId("export-large");
        const reservationCount = 65_600;
        const labels = Array.from(
          { length: reservationCount },
          (_, index) => `export-large-${index}`
        );
        // One raw statement: the fixture's chunked inserts take about three
        // times as long for this many rows.
        await testDatabase.pool.query(
          `insert into workspace_reservations (
            id, checkout_attempt_key, author_account_id, dotypos_customer_id,
            dotypos_reservation_id, reservation_state, payment_state, paid_at,
            fulfillment_state, fulfilled_at, reservation_details, locale
          )
          select 'admin-' || label, 'attempt-' || label, $3, $2,
            'booking-' || label, 'confirmed', 'paid', now(), 'fulfilled', now(),
            '{"kind":"cowork","entryTier":"open-space","coffee":false}'::jsonb,
            'en-US'
          from unnest($1::text[]) as label`,
          [
            labels.map((label) => `${label}-${runId}`),
            customerId,
            fixtureReservationAuthorId,
          ]
        );
        reservationIds.push(
          ...labels.map((label) =>
            workspaceReservationIdSchema.make(`admin-${label}-${runId}`)
          )
        );
        // Dotypos orders the bookings in the reverse of their insertion.
        const expected = labels.toReversed().map(bookingId);
        const bookings = expected.map((id, index) => ({
          _branchId: "branch",
          _cloudId: "cloud",
          _customerId: "dotypos-customer",
          endDate: "2026-10-10T10:00:00Z",
          id,
          seats: "1",
          startDate: Temporal.Instant.from("2026-10-01T08:00:00Z")
            .add({ seconds: index })
            .toString(),
          status: "CONFIRMED" as const,
        }));
        const exported = await run(
          (administration) =>
            administration.exportReservations({
              customerId,
              direction: "asc",
              from: "2026-10-01",
              sort: "date",
              to: "2026-10-31",
            }),
          {
            listReservations: () => Effect.succeed(bookings),
            getReservationsByIds: (ids) =>
              Effect.succeed(bookings).pipe(
                Effect.flatMap((records) =>
                  seededReservationReads(records).getReservationsByIds(ids)
                )
              ),
          }
        );

        expect(
          exported.map(({ dotyposReservationId }) => dotyposReservationId)
        ).toEqual(expected);
      });

      test("orders an early-setup meeting room by its booked start", async () => {
        const customerId = makeCustomerId("early-setup-order");
        const reservations = [
          // Dotypos holds the early-setup room from 23:45 for a midnight
          // booking, ahead of the bookings starting before midnight.
          {
            label: "early-setup-order-setup",
            details: { kind: "meeting-room", earlySetup: true },
            heldFrom: "2026-10-09T21:45:00Z",
          },
          {
            label: "early-setup-order-unflagged",
            details: { kind: "meeting-room" },
            heldFrom: "2026-10-09T21:50:00Z",
          },
          {
            label: "early-setup-order-cowork",
            details: openSpaceDetails,
            heldFrom: "2026-10-09T21:55:00Z",
          },
        ] as const;
        for (const { label, details } of reservations) {
          const { id } = await Effect.runPromise(
            workspaceFixtures(testDatabase.db).reservation({
              stage: {
                reservation: "confirmed",
                payment: "paid",
                fulfillment: "fulfilled",
              },
              customer: customerId,
              details,
              overrides: { dotyposReservationId: bookingId(label) },
            })
          );
          reservationIds.push(id);
        }
        const bookings = reservations.map(({ label, heldFrom }) => ({
          _branchId: "branch",
          _cloudId: "cloud",
          _customerId: customerId,
          endDate: "2026-10-10T02:00:00Z",
          id: bookingId(label),
          seats: "1",
          startDate: heldFrom,
          status: "CONFIRMED" as const,
        }));
        const exportOrder = (
          input: Pick<
            AdministrationReservationExportInput,
            "direction" | "from" | "to"
          >
        ) =>
          run(
            (administration) =>
              administration.exportReservations({
                ...input,
                customerId,
                sort: "date",
              }),
            {
              listReservations: (options) =>
                Effect.succeed(
                  options?.order === "startDateDescending"
                    ? bookings.toReversed()
                    : bookings
                ),
              getReservationsByIds: (ids, readOptions) => {
                const options = { ...readOptions, ids: [...ids] };
                return Effect.succeed(
                  options?.order === "startDateDescending"
                    ? bookings.toReversed()
                    : bookings
                ).pipe(
                  Effect.flatMap((records) =>
                    seededReservationReads(records).getReservationsByIds(ids)
                  )
                );
              },
            }
          ).then((exported) =>
            exported.map(({ dotyposReservationId }) => dotyposReservationId)
          );
        const bookedOrder = [
          "early-setup-order-unflagged",
          "early-setup-order-cowork",
          "early-setup-order-setup",
        ].map(bookingId);

        expect(await exportOrder({ direction: "asc" })).toEqual(bookedOrder);
        expect(await exportOrder({ direction: "desc" })).toEqual(
          bookedOrder.toReversed()
        );
        expect(
          await exportOrder({
            direction: "asc",
            from: "2026-10-09",
            to: "2026-10-10",
          })
        ).toEqual(bookedOrder);
      });
    });

    describe("stored reservation details", () => {
      const customerId = makeCustomerId("stored-details");
      const favoriteOfficeCustomerId = makeCustomerId("stored-details-office");
      const products = {
        openSpace: openSpaceDetails,
        reservedDesk: {
          kind: "cowork",
          entryTier: "reserved-desk",
          coffee: true,
          monitorOption: "2x27-4k",
        },
        retiredProfi: {
          kind: "cowork",
          entryTier: "profi",
          coffee: true,
          monitorOption: "2x32-qhd",
        },
        meetingRoom: {
          kind: "meeting-room",
          duration: { unit: "hour", amount: 4 },
        },
        office: { kind: "office", seats: 4, dayCount: 3 },
      } as const satisfies Record<string, StoredWorkspaceReservationDetails>;
      type Product = keyof typeof products;
      const ids = new Map<WorkspaceReservationId, Product>();

      const insert = async (
        customer: DotyposCustomerId,
        label: string,
        details: StoredWorkspaceReservationDetails
      ) => {
        const { id } = await Effect.runPromise(
          workspaceFixtures(testDatabase.db).reservation({
            stage: {
              reservation: "confirmed",
              payment: "paid",
              fulfillment: "fulfilled",
            },
            customer,
            details,
            overrides: {
              dotyposReservationId: bookingId(`stored-details-${label}`),
            },
          })
        );
        reservationIds.push(id);
        return id;
      };

      beforeAll(async () => {
        for (const product of Object.keys(products) as Product[]) {
          ids.set(
            await insert(customerId, product, products[product]),
            product
          );
        }
        await insert(favoriteOfficeCustomerId, "office-a", products.office);
        await insert(favoriteOfficeCustomerId, "office-b", products.office);
        await insert(favoriteOfficeCustomerId, "cowork", products.openSpace);
      });

      const productsOf = (items: readonly { readonly id: string }[]) =>
        items.map(({ id }) => ids.get(id as WorkspaceReservationId));

      test("filters reservations by their product family", async () => {
        const listed = await Promise.all(
          (["cowork", "meeting-room", "office"] as const).map((type) =>
            run((administration) =>
              administration.listReservations({ customerId, type })
            )
          )
        );

        expect(listed.map(({ items }) => productsOf(items).sort())).toEqual([
          ["openSpace", "reservedDesk", "retiredProfi"],
          ["meetingRoom"],
          ["office"],
        ]);
      });

      test("sorts reservations by their product, with offices last", async () => {
        const [ascending, descending] = await Promise.all(
          (["asc", "desc"] as const).map((direction) =>
            run((administration) =>
              administration.listReservations({
                customerId,
                direction,
                sort: "reservation",
              })
            )
          )
        );

        expect(productsOf(ascending?.items ?? [])).toEqual([
          "openSpace",
          "retiredProfi",
          "reservedDesk",
          "meetingRoom",
          "office",
        ]);
        expect(productsOf(descending?.items ?? [])).toEqual([
          "office",
          "meetingRoom",
          "reservedDesk",
          "retiredProfi",
          "openSpace",
        ]);
      });

      test("names each reservation's product", async () => {
        const { items } = await run((administration) =>
          administration.listReservations({ customerId, sort: "created" })
        );
        const loaded = await Promise.all(
          [...ids.keys()].map((id) =>
            run((administration) => administration.loadReservationProduct(id))
          )
        );

        expect(
          Object.fromEntries(
            items.map((item) => [
              ids.get(item.id),
              { type: item.type, product: item.product, label: item.typeLabel },
            ])
          )
        ).toEqual({
          openSpace: {
            type: "cowork",
            product: { kind: "cowork", tier: "open-space" },
            label: "Open Space",
          },
          reservedDesk: {
            type: "cowork",
            product: { kind: "cowork", tier: "reserved-desk" },
            label: "Reserved Desk",
          },
          retiredProfi: {
            type: "cowork",
            product: { kind: "cowork", tier: "profi" },
            label: "Profi Workstation",
          },
          meetingRoom: {
            type: "meeting-room",
            product: { kind: "meeting-room" },
            label: "Meeting Room",
          },
          office: {
            type: "office",
            product: { kind: "office" },
            label: "Private Office",
          },
        });
        expect(loaded).toEqual([
          { kind: "cowork", tier: "open-space" },
          { kind: "cowork", tier: "reserved-desk" },
          { kind: "cowork", tier: "profi" },
          { kind: "meeting-room" },
          { kind: "office" },
        ]);
      });

      test("picks the most booked product as the customer's favorite", async () => {
        const [mixed, offices] = await Promise.all(
          [customerId, favoriteOfficeCustomerId].map((customer) =>
            run((administration) =>
              administration.loadCustomerActivity(customer)
            )
          )
        );

        // A tie goes to the first family and tier by name.
        expect(mixed?.stats.favoriteReservationProduct).toEqual({
          kind: "cowork",
          tier: "open-space",
        });
        expect(mixed?.stats.favoriteProduct).toBe("Cowork Open-space");
        expect(offices?.stats.favoriteReservationProduct).toEqual({
          kind: "office",
        });
        expect(offices?.stats.favoriteProduct).toBeNull();
        expect(productsOf(mixed?.reservations ?? []).sort()).toEqual(
          Object.keys(products).sort()
        );
      });
    });
  }
);
