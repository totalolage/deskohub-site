import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { ExternalAPIError } from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { Cause, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
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
                getCustomers: (ids) =>
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
    let selectCall = 0;
    const itemCalls: string[] = [];

    const result = await Effect.gen(function* () {
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
                getCustomers: () => Effect.succeed([]),
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

    expect(result.items[0]?.customer?.displayName).toBe("Ada");
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

  test("loads all overview buckets with one provider call", async () => {
    const currentDate = Temporal.Now.instant()
      .toZonedDateTimeISO("Europe/Prague")
      .toPlainDate();
    const linkedIds = ["last-week", "today", "upcoming"];
    const listInputs: unknown[] = [];
    const providerReservation = (id: string, date: Temporal.PlainDate) => ({
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: "customer",
      id,
      startDate: date.toZonedDateTime("Europe/Prague").toInstant().toString(),
      endDate: date
        .toZonedDateTime("Europe/Prague")
        .add({ hours: 1 })
        .toInstant()
        .toString(),
      seats: "1",
      status: "CONFIRMED" as const,
    });

    const result = await Effect.gen(function* () {
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
                    select: () => makeQuery(linkedIds.map((id) => ({ id }))),
                  } as never,
                })
              ),
              DotyposServiceMock({
                listReservations: (input) =>
                  Effect.sync(() => {
                    listInputs.push(input);
                    return [
                      providerReservation(
                        "last-week",
                        currentDate.subtract({ days: 6 })
                      ),
                      providerReservation("today", currentDate),
                      providerReservation(
                        "upcoming",
                        currentDate.add({ days: 1 })
                      ),
                      providerReservation("unlinked", currentDate),
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

    expect(listInputs).toHaveLength(1);
    expect(listInputs[0]).toMatchObject({ order: "startDateAscending" });
    expect(result.today).toEqual({ unavailable: false, value: 1 });
    expect(result.upcoming).toEqual({ unavailable: false, value: 1 });
    expect(result.lastSevenDays).toEqual({ unavailable: false, value: 2 });
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
