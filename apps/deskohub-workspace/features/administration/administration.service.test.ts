import "@/shared/testing/workspace-test-env";
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { ExternalAPIError } from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { Cause, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceSiteConstants } from "@/shared/utils";
import { AdministrationService } from "./administration.service";
import { PaymentAdministrationServiceMock } from "./payment-administration.service.mock";
import { PostHogReservationHistory } from "./posthog-reservation-history";

const makeQuery = <A>(rows: readonly A[]) => {
  const query = Effect.succeed(rows) as Effect.Effect<readonly A[]> & {
    from: () => typeof query;
    groupBy: () => typeof query;
    innerJoin: () => typeof query;
    limit: () => typeof query;
    offset: () => typeof query;
    orderBy: () => typeof query;
    where: () => typeof query;
  };
  query.from = () => query;
  query.groupBy = () => query;
  query.innerJoin = () => query;
  query.limit = () => query;
  query.offset = () => query;
  query.orderBy = () => query;
  query.where = () => query;
  return query;
};

afterEach(() => setSystemTime());

describe("AdministrationService", () => {
  test("sorts bookings before selecting a page", async () => {
    const bookings = Array.from({ length: 25 }, (_, index) => ({
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: null,
      id: `booking-${String(index).padStart(2, "0")}`,
      startDate: `2026-08-10T${String(index % 24).padStart(2, "0")}:00:00Z`,
      endDate: `2026-08-10T${String(index % 24).padStart(2, "0")}:30:00Z`,
      seats: "1",
      status: index === 24 ? ("CANCELLED" as const) : ("NEW" as const),
    }));

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listBookings({
        date: "2026-08-10",
        direction: "asc",
        page: 1,
        sort: "status",
      });
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({
                  db: { select: () => makeQuery([]) } as never,
                })
              ),
              DotyposServiceMock({
                getCustomers: () => Effect.succeed([]),
                getTables: () => Effect.succeed([]),
                listReservations: () => Effect.succeed(bookings),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result.items).toHaveLength(24);
    expect(result.items[0]?.status).toBe("CANCELLED");
  });

  test("filters reservations by an inclusive provider date range", async () => {
    const listInputs: unknown[] = [];
    const rows = [[{ value: 0 }], []] as const;
    let selectCall = 0;
    const database = {
      select: () => makeQuery(rows[selectCall++] ?? []),
    };

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listReservations({
        from: "2026-08-06",
        to: "2026-08-12",
      });
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
              ),
              DotyposServiceMock({
                listReservations: (input) =>
                  Effect.sync(() => {
                    listInputs.push(input);
                    return [];
                  }),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(listInputs).toEqual([
      {
        startsAtOrAfter: "2026-08-05T22:00:00Z",
        startsBefore: "2026-08-12T22:00:00Z",
        order: "startDateAscending",
      },
    ]);
    expect(result.total).toBe(0);
  });

  test("keeps single-sided provider date ranges open", async () => {
    const listInputs: unknown[] = [];
    const rows = [[{ value: 0 }], [], [{ value: 0 }], []] as const;
    let selectCall = 0;
    const database = {
      select: () => makeQuery(rows[selectCall++] ?? []),
    };

    await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      yield* administration.listReservations({ from: "2026-08-06" });
      yield* administration.listReservations({ to: "2026-08-12" });
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
              ),
              DotyposServiceMock({
                listReservations: (input) =>
                  Effect.sync(() => {
                    listInputs.push(input);
                    return [];
                  }),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(listInputs).toEqual([
      {
        startsAtOrAfter: "2026-08-05T22:00:00Z",
        order: "startDateAscending",
      },
      {
        startsBefore: "2026-08-12T22:00:00Z",
        order: "startDateAscending",
      },
    ]);
  });

  test("keeps reservations available when provider date sorting fails", async () => {
    const instant = Temporal.Instant.from("2026-08-10T08:00:00Z");
    const row = {
      id: "workspace-reservation",
      dotyposCustomerId: "dotypos-customer",
      dotyposReservationId: "dotypos-reservation",
      reservationState: "confirmed",
      paymentState: "paid",
      fulfillmentState: "fulfilled",
      reservationPurpose: "business",
      reservationDetails: { kind: "meeting-room" },
      reservationCreatedAt: instant,
      reservationConfirmedAt: instant,
      reservationCancelledAt: null,
      reservationHoldExpiredAt: null,
      paidAt: instant,
      fulfilledAt: instant,
      fulfillmentFailedAt: null,
      createdAt: instant,
      updatedAt: instant,
    } as const;
    const rows = [[{ value: 1 }], [row], []] as const;
    let selectCall = 0;
    const database = {
      select: () => makeQuery(rows[selectCall++] ?? []),
    };

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listReservations({
        direction: "asc",
        sort: "date",
      });
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
              ),
              DotyposServiceMock({
                getCustomers: () =>
                  Effect.succeed([{ id: "dotypos-customer" }]),
                listReservations: () =>
                  Effect.fail(
                    new ExternalAPIError({
                      operation: "listReservations",
                      service: "Dotypos",
                      statusCode: 503,
                    })
                  ),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(selectCall).toBe(5);
    expect(result.dateSortUnavailable).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.purpose).toBe("business");
  });

  test("reports an awaiting-delivery reservation as delivering confirmation", async () => {
    const instant = Temporal.Instant.from("2026-08-10T08:00:00Z");
    const row = {
      id: "workspace-reservation",
      dotyposCustomerId: "dotypos-customer",
      dotyposReservationId: "dotypos-reservation",
      reservationState: "confirmed",
      paymentState: "paid",
      fulfillmentState: "awaiting_delivery",
      reservationPurpose: "business",
      reservationDetails: { kind: "meeting-room" },
      reservationCreatedAt: instant,
      reservationConfirmedAt: instant,
      reservationCancelledAt: null,
      reservationHoldExpiredAt: null,
      paidAt: instant,
      fulfilledAt: null,
      fulfillmentFailedAt: null,
      failureCode: null,
      createdAt: instant,
      updatedAt: instant,
    } as const;
    const rows = [[{ value: 1 }], [row], [], [], []] as const;
    let selectCall = 0;
    const database = {
      select: () => makeQuery(rows[selectCall++] ?? []),
    };

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listReservations({});
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
              ),
              DotyposServiceMock({
                getCustomers: () =>
                  Effect.succeed([{ id: "dotypos-customer" }]),
                listReservations: () =>
                  Effect.succeed([
                    {
                      _branchId: "branch",
                      _cloudId: "cloud",
                      _customerId: "dotypos-customer",
                      id: "dotypos-reservation",
                      startDate: "2026-08-10T10:00:00Z",
                      endDate: "2026-08-10T11:00:00Z",
                      seats: "1",
                      status: "CONFIRMED" as const,
                    },
                  ]),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result.items[0]?.status).toEqual({
      group: "in_progress",
      label: "Delivering confirmation",
    });
    expect(result.items[0]?.statusNote).toBeNull();
  });

  test("flags queued late-payment recovery ahead of cleanup state", async () => {
    const instant = Temporal.Instant.from("2026-08-10T08:00:00Z");
    const row = {
      id: "workspace-reservation",
      dotyposCustomerId: "dotypos-customer",
      dotyposReservationId: "dotypos-reservation",
      reservationState: "held",
      paymentState: "pending",
      fulfillmentState: "not_started",
      failureCode: "payment_outcome_unconfirmed_before_cleanup",
      reservationPurpose: null,
      reservationDetails: { kind: "meeting-room" },
      reservationCreatedAt: instant,
      reservationConfirmedAt: null,
      reservationCancelledAt: null,
      reservationHoldExpiredAt: instant,
      paidAt: null,
      fulfilledAt: null,
      fulfillmentFailedAt: null,
      createdAt: instant,
      updatedAt: instant,
    } as const;
    const rows = [
      [{ value: 1 }],
      [row],
      [],
      [],
      [
        {
          paymentAttemptId: "payment-attempt",
          reservationId: row.id,
          state: "processing",
          failureCode: null,
          verifiedPaidAt: instant,
          completedAt: null,
        },
      ],
    ] as const;
    let selectCall = 0;
    let recoveryOrderByCalls = 0;

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listReservations({});
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({
                  db: {
                    select: () => {
                      const call = selectCall++;
                      const query = makeQuery(rows[call] ?? []);
                      if (call === 4) {
                        query.orderBy = () => {
                          recoveryOrderByCalls += 1;
                          return query;
                        };
                      }
                      return query;
                    },
                  } as never,
                })
              ),
              DotyposServiceMock({
                getCustomers: () =>
                  Effect.succeed([{ id: "dotypos-customer" }]),
                listReservations: () =>
                  Effect.succeed([
                    {
                      _branchId: "branch",
                      _cloudId: "cloud",
                      _customerId: "dotypos-customer",
                      id: "dotypos-reservation",
                      startDate: "2026-08-10T10:00:00Z",
                      endDate: "2026-08-10T11:00:00Z",
                      seats: "1",
                      status: "CONFIRMED",
                    },
                  ]),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result.items[0]?.statusNote).toBe("Recovery in progress");
    expect(result.items[0]?.status.label).toBe("Recovering payment");
    expect(recoveryOrderByCalls).toBe(1);
  });

  test("enriches a full reservation page with two provider calls", async () => {
    const instant = Temporal.Instant.from("2026-08-10T08:00:00Z");
    const reservationRows = Array.from({ length: 24 }, (_, index) => ({
      id: `workspace-reservation-${index}`,
      dotyposCustomerId: `customer-${index}`,
      dotyposReservationId: `reservation-${index}`,
      reservationState: "confirmed",
      paymentState: "paid",
      fulfillmentState: "fulfilled",
      reservationPurpose: null,
      reservationDetails: { kind: "meeting-room" as const },
      reservationCreatedAt: instant,
      reservationConfirmedAt: instant,
      reservationCancelledAt: null,
      reservationHoldExpiredAt: null,
      paidAt: instant,
      fulfilledAt: instant,
      fulfillmentFailedAt: null,
      createdAt: instant,
      updatedAt: instant,
    }));
    const rows = [[{ value: 24 }], reservationRows, [], [], []] as const;
    let selectCall = 0;
    const reservationCalls: string[][] = [];
    const customerCalls: string[][] = [];

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listReservations({});
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({
                  db: {
                    select: () => makeQuery(rows[selectCall++] ?? []),
                  } as never,
                })
              ),
              DotyposServiceMock({
                getCustomers: ({ ids = [] }) =>
                  Effect.sync(() => {
                    customerCalls.push([...ids]);
                    return ids.map((id) => ({ id }));
                  }),
                listReservations: (input) =>
                  Effect.sync(() => {
                    const ids = [...(input.ids ?? [])];
                    reservationCalls.push(ids);
                    return ids.map((id, index) => ({
                      _branchId: "branch",
                      _cloudId: "cloud",
                      _customerId: `customer-${index}`,
                      id,
                      startDate: "2026-08-10T10:00:00Z",
                      endDate: "2026-08-10T11:00:00Z",
                      seats: "1",
                      status: "CONFIRMED" as const,
                    }));
                  }),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result.items).toHaveLength(24);
    expect(result.items.every(({ customer }) => customer !== null)).toBe(true);
    expect(reservationCalls).toHaveLength(1);
    expect(reservationCalls[0]).toHaveLength(24);
    expect(customerCalls).toHaveLength(1);
    expect(customerCalls[0]).toHaveLength(24);
  });

  test("falls back to item customer reads when a batch omits a customer", async () => {
    const customerId = "dotypos-customer";
    const rows = [
      [{ value: 1 }],
      [
        {
          customerId,
          reservationCount: 2,
          lastActivityAt: Temporal.Instant.from("2026-08-14T12:00:00Z"),
        },
      ],
    ] as const;
    let batchFails = false;
    let selectCall = 0;
    const itemCalls: string[] = [];

    const loadCustomers = () =>
      Effect.gen(function* () {
        const administration = yield* AdministrationService;
        return yield* administration.listCustomers({});
      }).pipe(
        Effect.provide(
          AdministrationService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  WorkspaceDatabase,
                  WorkspaceDatabase.of({
                    db: {
                      select: () => makeQuery(rows[selectCall++] ?? []),
                    } as never,
                  })
                ),
                DotyposServiceMock({
                  getCustomer: (id) =>
                    Effect.sync(() => {
                      itemCalls.push(id);
                      return { firstName: "Ada", id };
                    }),
                  getCustomers: () =>
                    batchFails
                      ? Effect.fail(
                          new ExternalAPIError({
                            operation: "getCustomers",
                            service: "Dotypos",
                            statusCode: 503,
                          })
                        )
                      : Effect.succeed([]),
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

    const result = await loadCustomers();
    expect(result.items[0]?.customer?.displayName).toBe("Ada");
    expect(itemCalls).toEqual([customerId]);

    batchFails = true;
    selectCall = 0;
    itemCalls.length = 0;
    expect((await loadCustomers()).items[0]?.customer?.displayName).toBe("Ada");
    expect(itemCalls).toEqual([customerId]);
  });

  test("rethrows Next prerender interruptions instead of returning unavailable details", async () => {
    const customerId = "dotypos-customer";
    const rows = [
      [{ value: 1 }],
      [
        {
          customerId,
          reservationCount: 1,
          lastActivityAt: Temporal.Instant.from("2026-08-14T12:00:00Z"),
        },
      ],
    ] as const;
    let selectCall = 0;
    const interruption = Object.assign(new Error("prerender interrupted"), {
      digest: "HANGING_PROMISE_REJECTION",
    });

    const exit = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listCustomers({});
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({
                  db: {
                    select: () => makeQuery(rows[selectCall++] ?? []),
                  } as never,
                })
              ),
              DotyposServiceMock({
                getCustomers: () =>
                  Effect.fail(
                    new Error("network request interrupted", {
                      cause: interruption,
                    })
                  ),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.exit,
      Effect.runPromise
    );

    expect(Cause.squash(exit.cause)).toBe(interruption);
  });

  test("loads reservation and customer overview activity", async () => {
    const currentDate = Temporal.Now.instant()
      .toZonedDateTimeISO("Europe/Prague")
      .toPlainDate();
    const linkedIds = [
      "last-week",
      "today",
      "upcoming",
      "cancelled-today",
      "new-today",
      "failed-today",
    ];
    const listInputs: {
      readonly order?: string;
    }[] = [];
    const customerListInputs: {
      readonly ids: readonly string[];
    }[] = [];
    let missingCustomerCreationTime = false;
    let reservationsUnavailable = false;
    const atTime = (date: Temporal.PlainDate, hour: number) =>
      date.toZonedDateTime("Europe/Prague").add({ hours: hour }).toInstant();
    const providerReservation = (
      id: string,
      customerId: string,
      date: Temporal.PlainDate,
      hour = 0
    ) => ({
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: customerId,
      id,
      startDate: atTime(date, hour).toString(),
      endDate: atTime(date, hour + 1).toString(),
      seats: "1",
      status: "CONFIRMED" as const,
    });
    const customerCreatedAt = new Map([
      [
        "customer-returning",
        atTime(currentDate.subtract({ days: 30 }), 8).toString(),
      ],
      ["customer-new-a", atTime(currentDate, 8).toString()],
      ["customer-new-b", atTime(currentDate, 9).toString()],
      ["customer-reassigned", atTime(currentDate, 10).toString()],
      [
        "customer-new-c",
        atTime(currentDate.subtract({ days: 30 }), 10).toString(),
      ],
    ]);
    const rowCustomerIds = {
      "last-week": "customer-returning",
      today: "customer-new-a",
      upcoming: "customer-upcoming",
      "cancelled-today": "customer-new-a",
      "new-today": "customer-new-b",
      "failed-today": "customer-new-c",
    } as const;
    const rangeRows = linkedIds.map((id) => ({
      id,
      customerId: rowCustomerIds[id as keyof typeof rowCustomerIds],
      failureCode: id === "failed-today" ? "access_failed" : null,
      fulfillmentState: id === "failed-today" ? "failed" : "fulfilled",
      paymentState: "paid",
      reservationState: "confirmed",
    }));
    const overviewReservations = [
      providerReservation(
        "last-week",
        "customer-returning",
        currentDate.subtract({ days: 6 })
      ),
      providerReservation("today", "customer-new-a", currentDate, 10),
      {
        ...providerReservation(
          "cancelled-today",
          "customer-new-a",
          currentDate,
          11
        ),
        status: "CANCELLED" as const,
      },
      {
        ...providerReservation("new-today", "customer-new-b", currentDate, 12),
        status: "NEW" as const,
      },
      providerReservation(
        "failed-today",
        "customer-reassigned",
        currentDate,
        13
      ),
      providerReservation(
        "upcoming",
        "customer-upcoming",
        currentDate.add({ days: 1 })
      ),
      providerReservation("unlinked", "customer-unlinked", currentDate),
    ];
    const loadOverview = () =>
      Effect.gen(function* () {
        const administration = yield* AdministrationService;
        return yield* administration.loadOverview();
      }).pipe(
        Effect.provide(
          AdministrationService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  WorkspaceDatabase,
                  WorkspaceDatabase.of({
                    db: {
                      select: () => makeQuery(rangeRows),
                    } as never,
                  })
                ),
                DotyposServiceMock({
                  getCustomers: (options) =>
                    Effect.sync(() => {
                      customerListInputs.push(options);
                      return options.ids.map((id) => ({
                        created:
                          missingCustomerCreationTime && id === "customer-new-a"
                            ? null
                            : customerCreatedAt.get(id),
                        firstName: id.replace("customer-", ""),
                        id,
                      }));
                    }),
                  listReservations: (input) => {
                    listInputs.push(input);
                    if (reservationsUnavailable) {
                      return Effect.fail(
                        new ExternalAPIError({
                          operation: "listReservations",
                          service: "Dotypos",
                          statusCode: 503,
                        })
                      );
                    }
                    return Effect.succeed(overviewReservations);
                  },
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
    const result = await loadOverview();

    expect(listInputs).toHaveLength(1);
    expect(listInputs[0]).toMatchObject({ order: "startDateAscending" });
    expect(customerListInputs).toEqual([
      {
        ids: [
          "customer-reassigned",
          "customer-new-b",
          "customer-new-a",
          "customer-returning",
        ],
      },
    ]);
    expect(result.today).toEqual({
      completed: 1,
      unavailable: false,
      value: 4,
    });
    expect(result.upcoming).toEqual({
      completed: 1,
      unavailable: false,
      value: 1,
    });
    expect(result.lastSevenDays).toEqual({
      completed: 2,
      unavailable: false,
      value: 5,
    });
    expect(result.uniqueCustomers).toEqual({
      customers: [
        {
          customer: {
            displayName: "reassigned",
            email: null,
            id: "customer-reassigned",
            phone: null,
          },
          customerId: "customer-reassigned",
        },
        {
          customer: {
            displayName: "new-b",
            email: null,
            id: "customer-new-b",
            phone: null,
          },
          customerId: "customer-new-b",
        },
        {
          customer: {
            displayName: "new-a",
            email: null,
            id: "customer-new-a",
            phone: null,
          },
          customerId: "customer-new-a",
        },
      ],
      unavailable: false,
      value: 4,
    });
    expect(result.newCustomers.value).toBeLessThanOrEqual(
      result.uniqueCustomers.value
    );
    expect(result.newCustomers).toEqual({
      customers: [
        {
          customer: {
            displayName: "reassigned",
            email: null,
            id: "customer-reassigned",
            phone: null,
          },
          customerId: "customer-reassigned",
        },
        {
          customer: {
            displayName: "new-b",
            email: null,
            id: "customer-new-b",
            phone: null,
          },
          customerId: "customer-new-b",
        },
        {
          customer: {
            displayName: "new-a",
            email: null,
            id: "customer-new-a",
            phone: null,
          },
          customerId: "customer-new-a",
        },
      ],
      unavailable: false,
      value: 3,
    });

    missingCustomerCreationTime = true;
    expect((await loadOverview()).newCustomers).toEqual({
      customers: [],
      unavailable: true,
      value: 0,
    });

    missingCustomerCreationTime = false;
    reservationsUnavailable = true;
    expect((await loadOverview()).newCustomers).toEqual({
      customers: [],
      unavailable: true,
      value: 0,
    });
  });

  test("returns no booking when Dotypos reports it missing", async () => {
    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadBooking("missing-booking");
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({
                  db: { select: () => makeQuery([]) } as never,
                })
              ),
              DotyposServiceMock({
                getReservation: () =>
                  Effect.fail(
                    new ExternalAPIError({
                      service: "Dotypos",
                      operation: "getReservation",
                      statusCode: 404,
                    })
                  ),
                getTables: () => Effect.succeed([]),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBeNull();
  });

  test("loads a reservation breadcrumb from only its product projection", async () => {
    const database = {
      select: () =>
        makeQuery([{ reservationDetails: { kind: "meeting-room" } }] as const),
    };

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadReservationBreadcrumbLabel(
        "workspace-reservation"
      );
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
              ),
              DotyposServiceMock({}),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("Meeting Room");
  });

  test("loads a booking breadcrumb without the full booking detail", async () => {
    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadBookingBreadcrumb("dotypos-booking");
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: {} as never })
              ),
              DotyposServiceMock({
                getReservation: () =>
                  Effect.succeed({
                    customer: { id: "dotypos-customer" },
                    reservation: {
                      _branchId: "branch",
                      _cloudId: "cloud",
                      _customerId: "dotypos-customer",
                      _tableId: "table-one",
                      id: "dotypos-booking",
                      startDate: "2026-08-10T10:00:00Z",
                      endDate: "2026-08-10T11:00:00Z",
                      seats: "1",
                      status: "CONFIRMED",
                    },
                  }),
                getTables: () =>
                  Effect.succeed([
                    {
                      id: "table-one",
                      name: "Meeting Room",
                    },
                  ]),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      startsAt: "2026-08-10T10:00:00Z",
      tableName: "Meeting Room",
    });
  });

  test("summarizes linked reservation dates through today in the Prague timezone", async () => {
    setSystemTime(new Date("2026-08-26T12:00:00Z"));
    const listInputs: unknown[] = [];
    const database = {
      select: () =>
        makeQuery([
          {
            id: "booking-one",
            reservationDetails: {
              kind: "cowork",
              entryTier: "basic",
              coffee: false,
            },
          },
          {
            id: "booking-two",
            reservationDetails: {
              kind: "cowork",
              entryTier: "plus",
              coffee: true,
            },
          },
          {
            id: "booking-profi",
            reservationDetails: {
              kind: "cowork",
              entryTier: "profi",
              coffee: true,
              monitorOption: "2x27-qhd",
            },
          },
          {
            id: "booking-meeting-room",
            reservationDetails: { kind: "meeting-room" },
          },
          {
            id: "booking-office",
            reservationDetails: { kind: "office" },
          },
          {
            id: "booking-today",
            reservationDetails: {
              kind: "cowork",
              entryTier: "plus",
              coffee: true,
            },
          },
        ]),
    };
    const booking = {
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: "dotypos-customer",
      endDate: "2026-08-10T23:00:00Z",
      seats: "1",
      status: "CONFIRMED" as const,
    };

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadCustomerReservationActivity(
        "dotypos-customer"
      );
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
              ),
              DotyposServiceMock({
                listReservations: (input) =>
                  Effect.sync(() => {
                    listInputs.push(input);
                    return [
                      {
                        ...booking,
                        id: "booking-one",
                        startDate: "2026-08-09T22:30:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-two",
                        startDate: "2026-08-10T18:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-profi",
                        startDate: "2026-08-11T08:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-meeting-room",
                        startDate: "2026-08-10T12:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-office",
                        startDate: "2026-08-12T08:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-not-linked",
                        startDate: "2026-08-13T08:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-today",
                        startDate: "2026-08-26T14:00:00Z",
                        endDate: "2026-08-26T15:00:00Z",
                      },
                    ];
                  }),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    const to = Temporal.Now.instant()
      .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
      .toPlainDate();
    expect(listInputs).toEqual([
      {
        customerId: "dotypos-customer",
        startsAtOrAfter: to
          .subtract({ days: 364 })
          .toZonedDateTime(workspaceSiteConstants.location.timeZone)
          .toInstant()
          .toString(),
        startsBefore: to
          .add({ days: 1 })
          .toZonedDateTime(workspaceSiteConstants.location.timeZone)
          .toInstant()
          .toString(),
        order: "startDateAscending",
      },
    ]);
    expect(result).toEqual({
      from: to.subtract({ days: 364 }).toString(),
      to: to.toString(),
      dates: [
        { category: "meeting-room", count: 3, date: "2026-08-10" },
        { category: "cowork-profi", count: 1, date: "2026-08-11" },
        { category: "office", count: 1, date: "2026-08-12" },
        { category: "cowork-plus", count: 1, date: "2026-08-26" },
      ],
    });
  });

  test("keeps unavailable reservation activity distinct from no activity", async () => {
    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadCustomerReservationActivity(
        "dotypos-customer"
      );
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({
                  db: { select: () => makeQuery([]) } as never,
                })
              ),
              DotyposServiceMock({
                listReservations: () =>
                  Effect.fail(
                    new ExternalAPIError({
                      operation: "listReservations",
                      service: "Dotypos",
                      statusCode: 503,
                    })
                  ),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result.dates).toBeNull();
  });

  test("loads customer marketing consent without a reservation", async () => {
    const grantedAt = Temporal.Instant.from("2026-08-09T10:00:00Z");
    const withdrawnAt = Temporal.Instant.from("2026-08-10T11:00:00Z");
    const rows = [
      [],
      [],
      [
        {
          documentHash: "marketing-document-hash",
          grantedAt,
          locale: "en-US" as const,
          withdrawnAt,
        },
      ],
    ] as const;
    let selectCall = 0;
    const database = {
      select: () => makeQuery(rows[selectCall++] ?? []),
    };

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadCustomerActivity("dotypos-customer");
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
              ),
              DotyposServiceMock({}),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(selectCall).toBe(3);
    expect(result.reservations).toEqual([]);
    expect(result.marketingConsent).toEqual({
      documentHash: "marketing-document-hash",
      grantedAt: grantedAt.toString(),
      locale: "en-US",
      withdrawnAt: withdrawnAt.toString(),
    });
  });
});
