import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { ExternalAPIError } from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AdministrationService } from "./administration.service";
import { PaymentAdministrationServiceMock } from "./payment-administration.service.mock";
import { PostHogReservationHistory } from "./posthog-reservation-history";

const makeQuery = <A>(rows: readonly A[]) => {
  const query = Effect.succeed(rows) as Effect.Effect<readonly A[]> & {
    from: () => typeof query;
    innerJoin: () => typeof query;
    limit: () => typeof query;
    offset: () => typeof query;
    orderBy: () => typeof query;
    where: () => typeof query;
  };
  query.from = () => query;
  query.innerJoin = () => query;
  query.limit = () => query;
  query.offset = () => query;
  query.orderBy = () => query;
  query.where = () => query;
  return query;
};

describe("AdministrationService", () => {
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
        AdministrationService.Live.pipe(
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
        AdministrationService.Live.pipe(
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
        AdministrationService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
              ),
              DotyposServiceMock({
                getReservation: () =>
                  Effect.succeed({
                    customer: { id: "dotypos-customer" },
                    reservation: {
                      _branchId: "branch",
                      _cloudId: "cloud",
                      _customerId: "dotypos-customer",
                      id: "dotypos-reservation",
                      startDate: "2026-08-10T10:00:00Z",
                      endDate: "2026-08-10T11:00:00Z",
                      seats: "1",
                      status: "CONFIRMED",
                    },
                  }),
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

    expect(selectCall).toBe(4);
    expect(result.dateSortUnavailable).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  test("flags a late payment ahead of an unconfirmed cleanup outcome", async () => {
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
      [
        {
          eventId: "late-payment-event",
          receivedAt: instant,
          reservationId: row.id,
        },
      ],
    ] as const;
    let selectCall = 0;

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listReservations({});
    }).pipe(
      Effect.provide(
        AdministrationService.Live.pipe(
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
                getReservation: () =>
                  Effect.succeed({
                    customer: { id: "dotypos-customer" },
                    reservation: {
                      _branchId: "branch",
                      _cloudId: "cloud",
                      _customerId: "dotypos-customer",
                      id: "dotypos-reservation",
                      startDate: "2026-08-10T10:00:00Z",
                      endDate: "2026-08-10T11:00:00Z",
                      seats: "1",
                      status: "CONFIRMED",
                    },
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

    expect(result.items[0]?.statusNote).toBe("Refund required");
    expect(result.items[0]?.status.label).toBe("Payment pending");
  });

  test("returns no booking when Dotypos reports it missing", async () => {
    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadBooking("missing-booking");
    }).pipe(
      Effect.provide(
        AdministrationService.Live.pipe(
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
        AdministrationService.Live.pipe(
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
        AdministrationService.Live.pipe(
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
        AdministrationService.Live.pipe(
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
