import { describe, expect, test } from "bun:test";
import { Effect, Exit, Option, Schema } from "effect";
import {
  type DotyposReadFailure,
  DotyposRejected,
  DotyposReservationCancelledError,
  DotyposUnavailable,
} from "../errors";
import type { Reservation } from "../generated/effect.gen";
import { dotyposIdReadBatchSize, dotyposIdReadRequests } from "../id-reads";
import {
  DotyposCustomerIdSchema,
  DotyposCustomerSchema,
  DotyposDiscountGroupIdSchema,
  DotyposDiscountGroupSchema,
  DotyposReservationIdSchema,
  DotyposReservationSchema,
  DotyposTableIdSchema,
} from "../types";
import { customerLifecycle } from "../utils/customer-lifecycle";
import {
  type InMemoryDotyposRequest,
  makeInMemoryDotypos,
} from "./in-memory-dotypos";
import { DotyposService } from "./service";
import { DotyposServiceMock } from "./service.mock";

const customerId = Schema.decodeUnknownSync(DotyposCustomerIdSchema);
const reservationId = Schema.decodeUnknownSync(DotyposReservationIdSchema);
const discountGroupId = Schema.decodeUnknownSync(DotyposDiscountGroupIdSchema);

const customer = (id: string, overrides: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(DotyposCustomerSchema)({
    _cloudId: "cloud-id",
    id,
    firstName: "Ada",
    points: null,
    flags: "0",
    display: true,
    deleted: false,
    ...overrides,
  });

const reservation = (overrides: Partial<Reservation>) =>
  Schema.decodeUnknownSync(DotyposReservationSchema)({
    _branchId: "branch-id",
    _cloudId: "cloud-id",
    _customerId: "customer-id",
    startDate: "2026-06-20T10:00:00.000Z",
    endDate: "2026-06-20T12:00:00.000Z",
    seats: "1",
    status: "NEW",
    ...overrides,
  });

const startOfDay = (day: number) =>
  new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString();

const at = (hour: number) => new Date(Date.UTC(2026, 0, 1, hour));

const run = Effect.runPromise;
const exit = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.exit(effect));

describe("makeInMemoryDotypos ID reads", () => {
  test("selects customers by ID, deleted included, in the order Dotypos holds them", async () => {
    const { service } = makeInMemoryDotypos({
      customers: [
        customer("customer-1"),
        customer("customer-2", { deleted: true }),
      ],
    });

    const selected = await run(
      service.getCustomersByIds([
        customerId("customer-2"),
        customerId("missing"),
        customerId("customer-1"),
      ])
    );

    expect([...selected.keys()]).toEqual([
      customerId("customer-1"),
      customerId("customer-2"),
    ]);
  });

  test("sends one request per batch of unique IDs", async () => {
    const requests: InMemoryDotyposRequest[] = [];
    const ids = Array.from({ length: dotyposIdReadBatchSize * 2 + 1 }, (_, n) =>
      customerId(`customer-${n}`)
    );
    const { service } = makeInMemoryDotypos(
      { customers: ids.map((id) => customer(id)) },
      { onRequest: (request) => Effect.sync(() => requests.push(request)) }
    );

    const selected = await run(service.getCustomersByIds([...ids, ...ids]));

    expect(selected.size).toBe(ids.length);
    expect(requests).toHaveLength(dotyposIdReadRequests(ids.length));
    expect(requests.map((request) => request.ids?.length)).toEqual([
      dotyposIdReadBatchSize,
      dotyposIdReadBatchSize,
      1,
    ]);
  });

  test("rejects an ID filter value before any request", async () => {
    const requests: InMemoryDotyposRequest[] = [];
    const { service } = makeInMemoryDotypos(
      {},
      { onRequest: (request) => Effect.sync(() => requests.push(request)) }
    );

    const result = await exit(
      service.getReservationsByIds([reservationId("first,second")])
    );

    expect(result).toEqual(
      Exit.fail(
        new DotyposRejected({
          operation: "getReservationsByIds",
          reason: "invalid-request",
          message: "ID filters contain an invalid value",
        })
      )
    );
    expect(requests).toEqual([]);
  });

  test("recovers only the failed batch with onBatchFailure", async () => {
    const ids = Array.from({ length: dotyposIdReadBatchSize + 1 }, (_, n) =>
      reservationId(`visit-${n}`)
    );
    const outage = new DotyposUnavailable({
      operation: "getReservationsByIds",
      reason: "server",
    });
    const failures: DotyposReadFailure[] = [];
    const { service } = makeInMemoryDotypos(
      { reservations: ids.map((id) => reservation({ id })) },
      {
        onRequest: (request) =>
          request.ids?.length === 1 ? Effect.fail(outage) : Effect.void,
      }
    );

    const selected = await run(
      service.getReservationsByIds(ids, {
        onBatchFailure: (failure) => Effect.sync(() => failures.push(failure)),
      })
    );

    expect(selected.size).toBe(dotyposIdReadBatchSize);
    expect(failures).toEqual([outage]);
  });

  test("applies the reservation filters to ID reads", async () => {
    const { service } = makeInMemoryDotypos({
      reservations: [
        reservation({ id: "early", startDate: startOfDay(0) }),
        reservation({ id: "late", startDate: startOfDay(5) }),
      ],
    });

    const selected = await run(
      service.getReservationsByIds(
        [reservationId("early"), reservationId("late")],
        { startsAtOrAfter: startOfDay(1) }
      )
    );

    expect([...selected.keys()]).toEqual([reservationId("late")]);
  });
});

describe("makeInMemoryDotypos reservation listings", () => {
  const visits = Array.from({ length: 250 }, (_, day) =>
    reservation({ id: `visit-${day}`, startDate: startOfDay(day) })
  );
  const { service } = makeInMemoryDotypos({
    reservations: [
      reservation({ id: "early", startDate: startOfDay(-1) }),
      ...visits.toReversed(),
      reservation({
        id: "other-customer",
        _customerId: "other-customer-id",
        startDate: startOfDay(10),
      }),
    ],
  });
  const options = {
    customerId: customerId("customer-id"),
    startsAtOrAfter: startOfDay(0),
    order: "startDateAscending",
  } as const;

  test("pages the filtered reservations by 100 with the next page", async () => {
    const pages = await run(
      Effect.all(
        [1, 2, 3].map((page) =>
          service.listReservationsPage({ ...options, page })
        )
      )
    );

    expect(pages.map((page) => page.reservations.length)).toEqual([
      100, 100, 50,
    ]);
    expect(pages.map((page) => page.nextPage)).toEqual([
      Option.some(2),
      Option.some(3),
      Option.none(),
    ]);
    expect(pages.flatMap((page) => page.reservations)).toEqual(visits);
  });

  test("applies the same filters as the full listing", async () => {
    const bounded = {
      ...options,
      startsBefore: startOfDay(20),
      order: "startDateDescending",
    } as const;

    const [listing, page] = await run(
      Effect.all([
        service.listReservations(bounded),
        service.listReservationsPage({ ...bounded, page: 1 }),
      ])
    );

    expect(listing).toEqual(visits.slice(0, 20).toReversed());
    expect(page).toEqual({ reservations: listing, nextPage: Option.none() });
  });

  test("rejects a page number below one and an invalid filter value", async () => {
    const [page, filter] = await Promise.all([
      exit(service.listReservationsPage({ page: 0 })),
      exit(service.listReservations({ startsBefore: "2026|01" })),
    ]);

    expect(page).toEqual(
      Exit.fail(
        new DotyposRejected({
          operation: "listReservationsPage",
          reason: "invalid-request",
          message: "Reservation page must be a positive integer",
        })
      )
    );
    expect(filter).toEqual(
      Exit.fail(
        new DotyposRejected({
          operation: "listReservations",
          reason: "invalid-request",
          message: "Reservation filters contain an invalid value",
        })
      )
    );
  });
});

describe("makeInMemoryDotypos active reservations", () => {
  const interval = { startDate: at(10), endDate: at(12) };

  test("pages the NEW and CONFIRMED reservations overlapping the interval", async () => {
    const overlapping = Array.from({ length: 150 }, (_, index) =>
      reservation({
        id: `overlapping-${index}`,
        status: index % 2 === 0 ? "NEW" : "CONFIRMED",
        startDate: at(9).toISOString(),
        endDate: at(11).toISOString(),
      })
    );
    const { service } = makeInMemoryDotypos({
      reservations: [
        ...overlapping,
        reservation({
          id: "cancelled",
          status: "CANCELLED",
          startDate: at(10).toISOString(),
          endDate: at(11).toISOString(),
        }),
        reservation({
          id: "ends-at-start",
          startDate: at(8).toISOString(),
          endDate: at(10).toISOString(),
        }),
        reservation({
          id: "starts-at-end",
          startDate: at(12).toISOString(),
          endDate: at(13).toISOString(),
        }),
      ],
    });

    const [pages, all] = await run(
      Effect.all([
        Effect.all(
          [1, 2].map((page) =>
            service.listActiveReservationsPage(interval, page)
          )
        ),
        service.listActiveReservationsOverlapping(interval),
      ])
    );

    expect(pages.map((page) => page.nextPage)).toEqual([
      Option.some(2),
      Option.none(),
    ]);
    expect(pages.flatMap((page) => page.reservations)).toEqual(overlapping);
    expect(all).toEqual(overlapping);
  });

  test("rejects an interval that ends before it starts", async () => {
    const { service } = makeInMemoryDotypos();

    const result = await exit(
      service.listActiveReservationsOverlapping({
        startDate: interval.endDate,
        endDate: interval.startDate,
      })
    );

    expect(result).toEqual(
      Exit.fail(
        new DotyposRejected({
          operation: "listActiveReservationsOverlapping",
          reason: "invalid-request",
          message: "Reservation end date must be after start date",
        })
      )
    );
  });
});

describe("makeInMemoryDotypos reservation transitions", () => {
  const create = {
    customerId: customerId("customer-id"),
    tableId: DotyposTableIdSchema.make("table-id"),
    seats: 2,
    status: "NEW",
    startDate: at(10),
    endDate: at(12),
    note: " Window seat ",
  } as const;

  test("creates a reservation later reads return with its customer", async () => {
    const { service } = makeInMemoryDotypos({
      customers: [customer("customer-id")],
    });

    const created = await run(service.createReservation(create));
    const read = await run(service.getReservation(created.id));

    expect(created).toMatchObject({
      _customerId: "customer-id",
      _tableId: "table-id",
      seats: "2",
      status: "NEW",
      note: "Window seat",
      startDate: at(10).toISOString(),
      endDate: at(12).toISOString(),
    });
    expect(read).toEqual(
      Option.some({ reservation: created, customer: customer("customer-id") })
    );
  });

  test("confirms a NEW reservation once under a new version", async () => {
    const { service } = makeInMemoryDotypos();
    const created = await run(service.createReservation(create));

    const confirmed = await run(service.confirmReservation(created.id));
    const again = await run(service.confirmReservation(created.id));

    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.versionDate! > created.versionDate!).toBe(true);
    expect(again).toEqual(confirmed);
    expect(await run(service.getReservationStatus(created.id))).toBe(
      "CONFIRMED"
    );
  });

  test("cancels a reservation, which leaves the active listing and can't be confirmed", async () => {
    const { service } = makeInMemoryDotypos();
    const created = await run(service.createReservation(create));

    await run(service.cancelReservation(created.id));

    expect(await run(service.getReservationStatus(created.id))).toBe(
      "CANCELLED"
    );
    expect(
      await run(
        service.listActiveReservationsOverlapping({
          startDate: at(10),
          endDate: at(12),
        })
      )
    ).toEqual([]);
    expect(await exit(service.confirmReservation(created.id))).toEqual(
      Exit.fail(
        new DotyposReservationCancelledError({
          reservationId: created.id,
          message: "Dotypos reservation is already cancelled.",
        })
      )
    );
  });

  test("updates the note and keeps the status", async () => {
    const { service } = makeInMemoryDotypos();
    const created = await run(service.createReservation(create));

    const updated = await run(
      service.updateReservation({ reservationId: created.id, note: " Late " })
    );

    expect(updated).toMatchObject({ status: "NEW", note: "Late" });
    expect(
      await run(service.getReservationWithoutCustomer(created.id))
    ).toEqual(updated);
  });

  test("answers a missing reservation as production does", async () => {
    const { service } = makeInMemoryDotypos();
    const missing = reservationId("missing");

    const results = await Promise.all([
      exit(service.getReservation(missing)),
      exit(service.getReservationStatus(missing)),
      exit(service.getReservationWithoutCustomer(missing)),
      exit(service.cancelReservation(missing)),
      exit(service.confirmReservation(missing)),
    ]);

    expect(results[0]).toEqual(Exit.succeed(Option.none()));
    expect(
      results
        .slice(1)
        .map((result: Exit.Exit<unknown, unknown>) =>
          Exit.isFailure(result) ? Exit.findErrorOption(result) : Option.none()
        )
    ).toEqual(
      (
        [
          ["getReservationStatus", "reservation.status"],
          ["getReservationWithoutCustomer", "reservation.get"],
          ["cancelReservation", "reservation.delete"],
          ["confirmReservation", "reservation.version"],
        ] as const
      ).map(([operation, request]) =>
        Option.some(
          new DotyposRejected({
            operation,
            request,
            reason: "not-found",
            message: "The in-memory Dotypos holds no such record.",
          })
        )
      )
    );
  });

  test("fails a reservation read whose linked customer is gone", async () => {
    const { service } = makeInMemoryDotypos({
      reservations: [reservation({ id: "orphan" })],
    });

    expect(await exit(service.getReservation(reservationId("orphan")))).toEqual(
      Exit.fail(
        new DotyposRejected({
          operation: "getReservation",
          request: "customer.get",
          reason: "not-found",
          message: "The in-memory Dotypos holds no such record.",
        })
      )
    );
  });

  test("rejects invalid creation input before any request", async () => {
    const requests: InMemoryDotyposRequest[] = [];
    const { service } = makeInMemoryDotypos(
      {},
      { onRequest: (request) => Effect.sync(() => requests.push(request)) }
    );

    const result = await exit(
      service.createReservation({ ...create, seats: 0 })
    );

    expect(result).toEqual(
      Exit.fail(
        new DotyposRejected({
          operation: "createReservation",
          reason: "invalid-request",
          message: "Reservation seats must be a positive integer",
        })
      )
    );
    expect(requests).toEqual([]);
  });
});

describe("makeInMemoryDotypos customer writes", () => {
  const discountGroups = [
    Schema.decodeUnknownSync(DotyposDiscountGroupSchema)({
      id: "group-10",
      name: "Ten",
      discountPercent: "10",
    }),
  ];

  test("sets and clears a discount group, each under a new version", async () => {
    const { service } = makeInMemoryDotypos({
      customers: [customer("customer-id")],
      discountGroups,
    });
    const id = customerId("customer-id");

    const set = await run(
      service.setCustomerDiscountGroup(id, discountGroupId("group-10"))
    );
    const group = await run(
      service.getCustomerDiscountGroup({ customerId: id })
    );
    const cleared = await run(service.setCustomerDiscountGroup(id, null));

    expect(group).toEqual({
      discountGroupId: discountGroupId("group-10"),
      discountPercent: discountGroups[0]!.discountPercent,
    });
    expect(cleared._discountGroupId).toBeNull();
    expect(cleared.versionDate! > set.versionDate!).toBe(true);
    expect(
      await run(service.getCustomerDiscountGroup({ customerId: id }))
    ).toBeUndefined();
  });

  test("expires and reactivates a customer", async () => {
    const { service } = makeInMemoryDotypos({
      customers: [customer("customer-id")],
    });
    const id = customerId("customer-id");

    await run(service.expireCustomer(id));
    const expired = await run(service.getCustomer(id));
    await run(service.reactivateCustomer(id));
    const reactivated = await run(service.getCustomer(id));

    expect(
      Option.map(expired, (read) => customerLifecycle(read, new Date()))
    ).toEqual(Option.some("expired"));
    expect(
      Option.map(reactivated, (read) => customerLifecycle(read, new Date()))
    ).toEqual(Option.some("active"));
  });

  test("answers a missing customer as production does", async () => {
    const { service } = makeInMemoryDotypos();
    const missing = customerId("missing");

    expect(await run(service.getCustomer(missing))).toEqual(Option.none());
    expect(await run(service.expireCustomer(missing))).toEqual(Option.none());
    expect(await exit(service.setCustomerDiscountGroup(missing, null))).toEqual(
      Exit.fail(
        new DotyposRejected({
          operation: "setCustomerDiscountGroup",
          request: "customer.version",
          reason: "not-found",
          message: "The in-memory Dotypos holds no such record.",
        })
      )
    );
  });
});

describe("makeInMemoryDotypos as a layer", () => {
  test("injects a failure with DotyposServiceMock over the fake", async () => {
    const dotypos = makeInMemoryDotypos({
      customers: [customer("customer-id")],
    });
    const outage = new DotyposUnavailable({
      operation: "getCustomer",
      reason: "timeout",
    });
    const layer = DotyposServiceMock({
      ...dotypos.service,
      getCustomer: () => Effect.fail(outage),
    });

    const [read, ids] = await run(
      Effect.flatMap(DotyposService, (service) =>
        Effect.all([
          Effect.exit(service.getCustomer(customerId("customer-id"))),
          service.getCustomersByIds([customerId("customer-id")]),
        ])
      ).pipe(Effect.provide(layer))
    );

    expect(read).toEqual(Exit.fail(outage));
    expect(ids.size).toBe(1);
  });

  test("dies naming an operation it does not model", async () => {
    const result = await run(
      Effect.flatMap(DotyposService, (service) =>
        Effect.exit(service.getCategories())
      ).pipe(Effect.provide(makeInMemoryDotypos().layer))
    );

    expect(Exit.isFailure(result) && Exit.hasDies(result)).toBe(true);
    expect(String(Exit.isFailure(result) && result.cause)).toContain(
      "does not model getCategories"
    );
  });

  test("returns edits made directly to its records", async () => {
    const dotypos = makeInMemoryDotypos();
    const id = customerId("customer-id");

    dotypos.customers.set(id, customer("customer-id", { firstName: "Grace" }));

    expect(
      Option.map(
        await run(dotypos.service.getCustomer(id)),
        (read) => read.firstName
      )
    ).toEqual(Option.some("Grace"));
  });
});
