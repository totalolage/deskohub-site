import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
  ExternalAPIError,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { Effect, Layer, Option } from "effect";
import { type ReservationState, workspaceReservations } from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  ReservationVisits,
  ReservationVisitsUnavailable,
} from "./reservation-visits.service";
import {
  countedDotyposReservationReads,
  reservationVisitsFake,
} from "./reservation-visits.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

/** How a Workspace reservation stands locally. */
type LocalState = "booked" | "unconfirmed" | "cancelled";

const reservationStates = {
  booked: "confirmed",
  unconfirmed: "held",
  cancelled: "cancelled",
} as const satisfies Record<LocalState, ReservationState>;

describe.skipIf(!testDatabase)(
  "ReservationVisits on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const runId = crypto.randomUUID();
    const insertedIds: WorkspaceReservationId[] = [];

    const customerId = (label: string) =>
      DotyposCustomerIdSchema.make(`visits-${label}-${runId}`);
    const workspaceId = (label: string) =>
      workspaceReservationIdSchema.make(`visits-${label}-${runId}`);
    const dotyposId = (label: string) =>
      DotyposReservationIdSchema.make(`visits-${label}-${runId}`);
    const at = (hour: number) =>
      Temporal.Instant.from("2026-11-02T00:00:00Z").add({ hours: hour });

    const insert = async (
      reservations: ReadonlyArray<{
        readonly label: string;
        readonly customer: DotyposCustomerId;
        readonly state?: LocalState;
      }>
    ) => {
      const confirmedAt = Temporal.Instant.from("2026-10-01T10:00:00Z");
      const rows = reservations.map(({ label, customer, state = "booked" }) => {
        const id = workspaceId(label);
        insertedIds.push(id);
        return {
          authorAccountId: fixtureReservationAuthorId,
          id,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(id),
          dotyposCustomerId: customer,
          dotyposReservationId: dotyposId(label),
          reservationState: reservationStates[state],
          reservationConfirmedAt: state === "unconfirmed" ? null : confirmedAt,
          paymentState: "paid" as const,
          paidAt: confirmedAt,
          fulfillmentState: "fulfilled" as const,
          fulfilledAt: confirmedAt,
          reservationDetails: {
            kind: "cowork" as const,
            entryTier: "open-space" as const,
            coffee: false,
          },
          locale: "cs-CZ" as const,
          updatedAt: confirmedAt,
        };
      });
      await Effect.runPromise(
        testDatabase.db.insert(workspaceReservations).values(rows)
      );
    };

    const dotyposReservation = (input: {
      readonly label: string;
      readonly customer: DotyposCustomerId;
      readonly startsAt?: Temporal.Instant;
      readonly status?: DotyposReservation["status"];
    }): DotyposReservation => {
      const startsAt = input.startsAt ?? at(9);
      return {
        id: dotyposId(input.label),
        _branchId: "branch",
        _cloudId: "cloud",
        _customerId: input.customer,
        startDate: startsAt.toString(),
        endDate: startsAt.add({ hours: 2 }).toString(),
        seats: "1",
        status: input.status ?? "CONFIRMED",
      };
    };

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [insertedIds]
      );
    });

    /** Builds one `ReservationVisits` instance for `effect`. */
    const withVisits = <A, E>(
      dotypos: ReturnType<typeof countedDotyposReservationReads>,
      effect: Effect.Effect<A, E, ReservationVisits>
    ) =>
      effect.pipe(
        Effect.provide(
          ReservationVisits.Default.pipe(
            Layer.provide(Layer.merge(testDatabase.layer, dotypos.layer))
          )
        )
      );

    test("reads 120 booked reservations in 3 sequential requests, as their cost says", async () => {
      const customers = ["a", "b", "c"].map((label) =>
        customerId(`cost-${label}`)
      );
      const bookings = Array.from({ length: 120 }, (_, index) => ({
        label: `cost-${index}`,
        customer: customers[index % 3]!,
      }));
      await insert(bookings);
      const dotypos = countedDotyposReservationReads(
        bookings.map(dotyposReservation)
      );

      const {
        cost,
        bookings: booked,
        visits,
      } = await Effect.runPromise(
        withVisits(
          dotypos,
          Effect.gen(function* () {
            const reservationVisits = yield* ReservationVisits;
            return {
              cost: yield* reservationVisits.cost(customers),
              bookings: yield* reservationVisits.bookings(customers),
              visits: yield* reservationVisits.ofCustomers(customers),
            };
          })
        )
      );

      expect(cost).toBe(3);
      expect(customers.map((id) => booked.get(id))).toEqual([40, 40, 40]);
      expect(dotypos.requests()).toBe(3);
      expect(dotypos.peakOpenRequests()).toBe(1);
      expect(customers.map((id) => visits.get(id)?.length)).toEqual([
        40, 40, 40,
      ]);
      expect(visits.get(customers[0]!)).toContainEqual({
        workspaceReservationId: workspaceId("cost-0"),
        dotyposReservationId: dotyposId("cost-0"),
        dotyposCustomerId: customers[0]!,
        startsAt: at(9),
        endsAt: at(11),
        status: "active",
      });
    });

    test("answers a repeat lookup from memory and refetches in a new instance", async () => {
      const customer = customerId("memo");
      const bookings = [
        { label: "memo-1", customer },
        { label: "memo-2", customer },
      ];
      await insert(bookings);
      const dotypos = countedDotyposReservationReads(
        bookings.map(dotyposReservation)
      );
      const ids = bookings.map(({ label }) => workspaceId(label));
      const lookUpTwice = Effect.gen(function* () {
        const reservationVisits = yield* ReservationVisits;
        const first = yield* reservationVisits.ofReservations(ids);
        const again = yield* reservationVisits.ofReservations(ids);
        const byCustomer = yield* reservationVisits.ofCustomers([customer]);
        return { first, again, byCustomer };
      });

      // The Workspace runtime shares one memo map, and units of work overlap, so
      // an instance built while another is alive must still be a new one.
      const [inFirst, inSecond] = await Effect.runPromise(
        withVisits(
          dotypos,
          Effect.gen(function* () {
            const first = yield* lookUpTwice;
            expect(dotypos.requests()).toBe(1);
            return [first, yield* withVisits(dotypos, lookUpTwice)] as const;
          })
        ).pipe(
          Effect.provideService(Layer.CurrentMemoMap, Layer.makeMemoMapUnsafe())
        )
      );

      expect(dotypos.requests()).toBe(2);
      expect(inFirst.again).toEqual(inFirst.first);
      expect(
        inFirst.byCustomer
          .get(customer)
          ?.map((visit) => visit.workspaceReservationId)
          .toSorted()
      ).toEqual(ids.toSorted());
      expect(inSecond.first).toEqual(inFirst.first);
    });

    test("reports reservations Dotypos doesn't return as none and cancelled ones as cancelled", async () => {
      const customer = customerId("status");
      await insert([
        { label: "status-missing", customer },
        { label: "status-cancelled", customer },
        { label: "status-new", customer },
      ]);
      const dotypos = countedDotyposReservationReads([
        dotyposReservation({
          label: "status-cancelled",
          customer,
          status: "CANCELLED",
        }),
        dotyposReservation({ label: "status-new", customer, status: "NEW" }),
      ]);

      const { byReservation, byCustomer } = await Effect.runPromise(
        withVisits(
          dotypos,
          Effect.gen(function* () {
            const reservationVisits = yield* ReservationVisits;
            return {
              byReservation: yield* reservationVisits.ofReservations(
                ["missing", "cancelled", "new"].map((label) =>
                  workspaceId(`status-${label}`)
                )
              ),
              byCustomer: yield* reservationVisits.ofCustomers([customer]),
            };
          })
        )
      );

      expect(byReservation.get(workspaceId("status-missing"))).toEqual(
        Option.none()
      );
      expect(
        Option.map(
          byReservation.get(workspaceId("status-cancelled"))!,
          (visit) => visit.status
        )
      ).toEqual(Option.some("cancelled"));
      expect(
        Option.map(
          byReservation.get(workspaceId("status-new"))!,
          (visit) => visit.status
        )
      ).toEqual(Option.some("active"));
      expect(
        byCustomer
          .get(customer)
          ?.map((visit) => visit.workspaceReservationId)
          .toSorted()
      ).toEqual(
        [workspaceId("status-cancelled"), workspaceId("status-new")].toSorted()
      );
      expect(dotypos.requests()).toBe(1);
    });

    test("never returns unconfirmed, Workspace-cancelled, or non-Workspace reservations", async () => {
      const customer = customerId("excluded");
      const excluded = [
        { label: "excluded-unconfirmed", customer, state: "unconfirmed" },
        { label: "excluded-cancelled", customer, state: "cancelled" },
      ] as const;
      await insert([{ label: "excluded-booked", customer }, ...excluded]);
      const dotypos = countedDotyposReservationReads(
        [
          "excluded-booked",
          "excluded-unconfirmed",
          "excluded-cancelled",
          "excluded-not-workspace",
        ].map((label) => dotyposReservation({ label, customer }))
      );

      const result = await Effect.runPromise(
        withVisits(
          dotypos,
          Effect.gen(function* () {
            const reservationVisits = yield* ReservationVisits;
            return {
              byReservation: yield* reservationVisits.ofReservations(
                excluded.map(({ label }) => workspaceId(label))
              ),
              byCustomer: yield* reservationVisits.ofCustomers([customer]),
              active: yield* reservationVisits.activeDuring(
                { startsAt: at(8), endsAt: at(12) },
                1
              ),
              cost: yield* reservationVisits.cost([customer]),
              bookings: yield* reservationVisits.bookings([customer]),
            };
          })
        )
      );

      expect([...result.byReservation.values()]).toEqual(
        excluded.map(() => Option.none())
      );
      const booked = [workspaceId("excluded-booked")];
      expect(
        result.byCustomer
          .get(customer)
          ?.map((visit) => visit.workspaceReservationId)
      ).toEqual(booked);
      expect(
        result.active.visits.map((visit) => visit.workspaceReservationId)
      ).toEqual(booked);
      expect(result.cost).toBe(1);
      expect([...result.bookings]).toEqual([[customer, 1]]);
    });

    test("follows a reschedule in Dotypos without any local change", async () => {
      const customer = customerId("moved");
      await insert([{ label: "moved", customer }]);
      const held = [dotyposReservation({ label: "moved", customer })];
      const dotypos = countedDotyposReservationReads(held);
      const lookUp = withVisits(
        dotypos,
        Effect.gen(function* () {
          const reservationVisits = yield* ReservationVisits;
          const visits = yield* reservationVisits.ofCustomers([customer]);
          return visits.get(customer);
        })
      );
      const before = await Effect.runPromise(lookUp);

      held[0] = dotyposReservation({
        label: "moved",
        customer,
        startsAt: at(33),
      });
      const after = await Effect.runPromise(lookUp);

      expect(before?.map(({ startsAt }) => startsAt)).toEqual([at(9)]);
      expect(after?.map(({ startsAt, endsAt }) => [startsAt, endsAt])).toEqual([
        [at(33), at(35)],
      ]);
    });

    test("pages the visits active during a window", async () => {
      const customer = customerId("paged");
      const bookings = Array.from({ length: 150 }, (_, index) => ({
        label: `paged-${index}`,
        customer,
      }));
      await insert(bookings);
      const dotypos = countedDotyposReservationReads([
        ...bookings.map(dotyposReservation),
        dotyposReservation({
          label: "paged-later",
          customer,
          startsAt: at(20),
        }),
      ]);
      const window = { startsAt: at(10), endsAt: at(12) };

      const pages = await Effect.runPromise(
        withVisits(
          dotypos,
          Effect.gen(function* () {
            const reservationVisits = yield* ReservationVisits;
            return yield* Effect.all([
              reservationVisits.activeDuring(window, 1),
              reservationVisits.activeDuring(window, 2),
            ]);
          })
        )
      );

      expect(pages.map(({ nextPage }) => nextPage)).toEqual([
        Option.some(2),
        Option.none(),
      ]);
      expect(
        pages.flatMap(({ visits }) =>
          visits.map((visit) => visit.workspaceReservationId)
        )
      ).toEqual(bookings.map(({ label }) => workspaceId(label)));
      expect(dotypos.requests()).toBe(2);

      const live = pages.flatMap(({ visits }) => visits);
      const fakePages = await Effect.runPromise(
        Effect.gen(function* () {
          const reservationVisits = yield* ReservationVisits;
          return yield* Effect.all([
            reservationVisits.activeDuring(window, 1),
            reservationVisits.activeDuring(window, 2),
          ]);
        }).pipe(
          Effect.provide(
            reservationVisitsFake([
              ...live,
              { ...live[0]!, status: "cancelled" },
              { ...live[0]!, startsAt: at(12), endsAt: at(14) },
            ])
          )
        )
      );
      expect(fakePages).toEqual(pages);
    });

    test("reports any Dotypos failure as unavailable without retrying", async () => {
      const customer = customerId("failing");
      await insert([{ label: "failing", customer }]);
      let requests = 0;
      const rateLimited = Effect.suspend(() => {
        requests += 1;
        return Effect.fail(
          new ExternalAPIError({
            service: "Dotypos",
            operation: "listReservationsPage",
            statusCode: 429,
          })
        );
      });
      const failing = DotyposServiceMock({
        listReservationsPage: () => rateLimited,
        listActiveReservationsPage: () => rateLimited,
      });

      const failures = await Effect.runPromise(
        Effect.gen(function* () {
          const reservationVisits = yield* ReservationVisits;
          return yield* Effect.all([
            Effect.flip(reservationVisits.ofCustomers([customer])),
            Effect.flip(
              reservationVisits.activeDuring(
                { startsAt: at(8), endsAt: at(12) },
                1
              )
            ),
          ]);
        }).pipe(
          Effect.provide(
            ReservationVisits.Default.pipe(
              Layer.provide(Layer.merge(testDatabase.layer, failing))
            )
          )
        )
      );

      for (const failure of failures) {
        expect(failure).toBeInstanceOf(ReservationVisitsUnavailable);
        expect(failure.cause).toMatchObject({ statusCode: 429 });
      }
      expect(requests).toBe(2);
    });
  }
);
