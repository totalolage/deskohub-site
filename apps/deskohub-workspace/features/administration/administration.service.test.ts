import {
  seededCustomerReads,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import "@/shared/testing/workspace-test-env";
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  type DotyposService,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { testEmailAddress } from "@deskohub/test-email";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type ReservationAuthor,
  ReservationAuthorDirectory,
  ReservationAuthorReadError,
} from "@/features/account";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  AdministrationService,
  getAdministrationReservationOverview,
} from "./administration.service";
import { PaymentAdministrationServiceMock } from "./payment-administration.service.mock";
import { PostHogReservationHistory } from "./posthog-reservation-history";

const makeQuery = <A>(
  rows: readonly A[],
  onWhere?: (condition: SQL | undefined) => void
) => {
  const query = Effect.succeed(rows) as Effect.Effect<readonly A[]> & {
    from: () => typeof query;
    groupBy: () => typeof query;
    innerJoin: () => typeof query;
    limit: () => typeof query;
    offset: () => typeof query;
    orderBy: () => typeof query;
    where: (condition?: SQL) => typeof query;
  };
  query.from = () => query;
  query.groupBy = () => query;
  query.innerJoin = () => query;
  query.limit = () => query;
  query.offset = () => query;
  query.orderBy = () => query;
  query.where = (condition) => {
    onWhere?.(condition);
    return query;
  };
  return query;
};

/**
 * A database select that returns the linkage rows, then, given early-setup
 * meeting rooms, their stored details.
 */
const linkageThenEarlySetupRows = <A>(
  linkageRows: readonly A[],
  earlySetupIds?: readonly string[]
) => {
  let selectCall = 0;
  return () =>
    selectCall++ === 0 || !earlySetupIds
      ? makeQuery<unknown>(linkageRows)
      : makeQuery<unknown>(
          earlySetupIds.map((dotyposReservationId) => ({
            dotyposReservationId,
            reservationDetails: { kind: "meeting-room", earlySetup: true },
          }))
        );
};

const reservationAuthorsMock = (
  describe: ReservationAuthorDirectory["Service"]["describe"] = () =>
    Effect.succeed(new Map())
) =>
  Layer.succeed(
    ReservationAuthorDirectory,
    ReservationAuthorDirectory.of({ describe })
  );

afterEach(() => setSystemTime());

describe("AdministrationService", () => {
  test("sorts bookings before selecting a page", async () => {
    const bookings = Array.from({ length: 25 }, (_, index) => ({
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: null,
      id: `booking-${String(index).padStart(2, "0")}`,
      startDate: `2026-08-10T${String(index % 24).padStart(2, "0")}:00:00+02:00`,
      endDate: `2026-08-10T${String(index % 24).padStart(2, "0")}:30:00+02:00`,
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
                WorkspaceDatabase.make({ select: () => makeQuery([]) } as never)
              ),
              DotyposServiceMock({
                getCustomersByIds: (ids) =>
                  Effect.succeed([]).pipe(
                    Effect.flatMap((records) =>
                      seededCustomerReads(records).getCustomersByIds(ids)
                    )
                  ),
                getTables: () => Effect.succeed([]),
                listReservations: () => Effect.succeed(bookings),
                getReservationsByIds: (ids) =>
                  ids.length === 0
                    ? Effect.succeed(new Map())
                    : Effect.succeed(bookings).pipe(
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
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
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

  test("lists early-setup bookings on their booked start", async () => {
    const instant = Temporal.Instant.from("2026-08-01T08:00:00Z");
    const earlySetup = { kind: "meeting-room", earlySetup: true } as const;
    // Dotypos holds each early-setup room from 15 minutes before its booked
    // start; Prague is UTC+2 in August.
    const heldStarts = {
      "early-setup": "2026-08-10T09:45:00+02:00",
      between: "2026-08-10T09:50:00+02:00",
      "midnight-early": "2026-08-09T23:45:00+02:00",
      "next-date-early": "2026-08-10T23:45:00+02:00",
    };
    const earlySetupIds = ["early-setup", "midnight-early", "next-date-early"];
    const rows = [
      earlySetupIds.map((dotyposReservationId) => ({
        dotyposReservationId,
        reservationDetails: earlySetup,
      })),
      earlySetupIds.map((id) => ({
        id: `workspace-${id}`,
        dotyposCustomerId: "customer",
        dotyposReservationId: id,
        reservationState: "confirmed",
        paymentState: "paid",
        fulfillmentState: "fulfilled",
        reservationPurpose: null,
        reservationDetails: earlySetup,
        reservationCreatedAt: instant,
        reservationConfirmedAt: instant,
        reservationCancelledAt: null,
        reservationHoldExpiredAt: null,
        paidAt: instant,
        fulfilledAt: instant,
        fulfillmentFailedAt: null,
        failureCode: null,
        createdAt: instant,
        updatedAt: instant,
      })),
    ] as const;
    const listInputs: unknown[] = [];
    let selectCall = 0;

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listBookings({
        date: "2026-08-10",
        direction: "asc",
        page: 1,
        sort: "date",
      });
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.make({
                  select: () => makeQuery<unknown>(rows[selectCall++] ?? []),
                } as never)
              ),
              DotyposServiceMock({
                getCustomersByIds: (ids) =>
                  Effect.succeed([]).pipe(
                    Effect.flatMap((records) =>
                      seededCustomerReads(records).getCustomersByIds(ids)
                    )
                  ),
                getTables: () => Effect.succeed([]),
                listReservations: (input) =>
                  Effect.sync(() => {
                    listInputs.push(input);
                    return Object.entries(heldStarts)
                      .toSorted(([, left], [, right]) =>
                        Temporal.Instant.compare(left, right)
                      )
                      .map(([id, startDate]) => ({
                        _branchId: "branch",
                        _cloudId: "cloud",
                        _customerId: null,
                        id,
                        startDate,
                        endDate: "2026-08-11T06:00:00+02:00",
                        seats: "1",
                        status: "CONFIRMED" as const,
                      }));
                  }),
                getReservationsByIds: (ids, readOptions) => {
                  if (ids.length === 0) return Effect.succeed(new Map());
                  const { concurrency, onBatchFailure, ...filters } =
                    readOptions ?? {};
                  const input = { ...filters, ids: [...ids] };
                  return Effect.sync(() => {
                    listInputs.push(input);
                    return Object.entries(heldStarts)
                      .toSorted(([, left], [, right]) =>
                        Temporal.Instant.compare(left, right)
                      )
                      .map(([id, startDate]) => ({
                        _branchId: "branch",
                        _cloudId: "cloud",
                        _customerId: null,
                        id,
                        startDate,
                        endDate: "2026-08-11T06:00:00+02:00",
                        seats: "1",
                        status: "CONFIRMED" as const,
                      }));
                  }).pipe(
                    Effect.flatMap((records) =>
                      seededReservationReads(records).getReservationsByIds(ids)
                    )
                  );
                },
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(listInputs).toEqual([
      {
        startsAtOrAfter: "2026-08-09T21:45:00Z",
        startsBefore: "2026-08-10T22:00:00Z",
        order: "startDateAscending",
      },
    ]);
    expect(result.items.map(({ id, startsAt }) => ({ id, startsAt }))).toEqual([
      { id: "midnight-early", startsAt: "2026-08-09T22:00:00.000Z" },
      { id: "between", startsAt: "2026-08-10T09:50:00+02:00" },
      { id: "early-setup", startsAt: "2026-08-10T08:00:00.000Z" },
    ]);
    expect(result.total).toBe(3);
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
                WorkspaceDatabase.make(database as never)
              ),
              DotyposServiceMock({
                listReservations: (input) =>
                  Effect.sync(() => {
                    listInputs.push(input);
                    return [];
                  }),
                getReservationsByIds: (ids, readOptions) => {
                  if (ids.length === 0) return Effect.succeed(new Map());
                  const { concurrency, onBatchFailure, ...filters } =
                    readOptions ?? {};
                  const input = { ...filters, ids: [...ids] };
                  return Effect.sync(() => {
                    listInputs.push(input);
                    return [];
                  }).pipe(
                    Effect.flatMap((records) =>
                      seededReservationReads(records).getReservationsByIds(ids)
                    )
                  );
                },
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(listInputs).toEqual([
      {
        startsAtOrAfter: "2026-08-05T21:45:00Z",
        startsBefore: "2026-08-12T22:00:00Z",
        order: "startDateAscending",
      },
    ]);
    expect(result.total).toBe(0);
  });

  test("filters early-setup bookings by their booked date", async () => {
    // Prague is UTC+2 in August. Bookings held from 23:45 or later may belong
    // to the next date, so only they read their stored details.
    const heldStarts = {
      "midnight-early": "2026-08-09T21:45:00Z",
      "midnight-on-time": "2026-08-09T21:50:00Z",
      noon: "2026-08-10T10:00:00Z",
      "late-early": "2026-08-10T21:45:00Z",
      "late-on-time": "2026-08-10T21:50:00Z",
    };
    const earlySetup = { kind: "meeting-room", earlySetup: true } as const;
    const rows = [
      [
        {
          dotyposReservationId: "midnight-early",
          reservationDetails: earlySetup,
        },
        { dotyposReservationId: "late-early", reservationDetails: earlySetup },
      ],
      [{ value: 0 }],
      [],
    ] as const;
    const conditionParams: unknown[] = [];
    let selectCall = 0;
    const database = {
      select: () =>
        makeQuery(rows[selectCall++] ?? [], (condition) => {
          if (condition) {
            conditionParams.push(
              ...new PgDialect().sqlToQuery(condition).params
            );
          }
        }),
    };

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listReservations({
        from: "2026-08-10",
        to: "2026-08-10",
      });
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.make(database as never)
              ),
              DotyposServiceMock({
                listReservations: () =>
                  Effect.succeed(
                    Object.entries(heldStarts).map(([id, startDate]) => ({
                      _branchId: "branch",
                      _cloudId: "cloud",
                      _customerId: "customer",
                      id,
                      startDate,
                      endDate: "2026-08-11T06:00:00Z",
                      seats: "1",
                      status: "CONFIRMED" as const,
                    }))
                  ),
                getReservationsByIds: (ids) =>
                  ids.length === 0
                    ? Effect.succeed(new Map())
                    : Effect.succeed(
                        Object.entries(heldStarts).map(([id, startDate]) => ({
                          _branchId: "branch",
                          _cloudId: "cloud",
                          _customerId: "customer",
                          id,
                          startDate,
                          endDate: "2026-08-11T06:00:00Z",
                          seats: "1",
                          status: "CONFIRMED" as const,
                        }))
                      ).pipe(
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
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result.dateFilterUnavailable).toBe(false);
    expect(conditionParams).toContainEqual([
      "midnight-early",
      "midnight-on-time",
      "late-early",
      "late-on-time",
    ]);
    expect(conditionParams).toContainEqual([
      "midnight-early",
      "noon",
      "late-on-time",
    ]);
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
                WorkspaceDatabase.make(database as never)
              ),
              DotyposServiceMock({
                listReservations: (input) =>
                  Effect.sync(() => {
                    listInputs.push(input);
                    return [];
                  }),
                getReservationsByIds: (ids, readOptions) => {
                  if (ids.length === 0) return Effect.succeed(new Map());
                  const { concurrency, onBatchFailure, ...filters } =
                    readOptions ?? {};
                  const input = { ...filters, ids: [...ids] };
                  return Effect.sync(() => {
                    listInputs.push(input);
                    return [];
                  }).pipe(
                    Effect.flatMap((records) =>
                      seededReservationReads(records).getReservationsByIds(ids)
                    )
                  );
                },
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(listInputs).toEqual([
      {
        startsAtOrAfter: "2026-08-05T21:45:00Z",
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
                WorkspaceDatabase.make(database as never)
              ),
              DotyposServiceMock({
                getCustomersByIds: (ids) =>
                  Effect.succeed([{ id: "dotypos-customer" }]).pipe(
                    Effect.flatMap((records) =>
                      seededCustomerReads(records).getCustomersByIds(ids)
                    )
                  ),
                listReservations: () =>
                  Effect.fail(
                    new DotyposUnavailable({
                      operation: "listReservations",
                      reason: "server",
                    })
                  ),
                getReservationsByIds: (ids) =>
                  ids.length === 0
                    ? Effect.succeed(new Map())
                    : Effect.fail(
                        new DotyposUnavailable({
                          operation: "listReservations",
                          reason: "server",
                        })
                      ).pipe(
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
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
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
                WorkspaceDatabase.make({
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
                } as never)
              ),
              DotyposServiceMock({
                getCustomersByIds: (ids) =>
                  Effect.succeed([{ id: "dotypos-customer" }]).pipe(
                    Effect.flatMap((records) =>
                      seededCustomerReads(records).getCustomersByIds(ids)
                    )
                  ),
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
                getReservationsByIds: (ids) =>
                  ids.length === 0
                    ? Effect.succeed(new Map())
                    : Effect.succeed([
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
                      ]).pipe(
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
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result.items[0]?.statusNote).toBe("Recovery in progress");
    expect(result.items[0]?.status.label).toBe("Recovering payment");
    expect(result.items[0]).toMatchObject({
      product: { kind: "meeting-room" },
      status: { code: "recovering_payment" },
      statusNoteCode: "recovery_in_progress",
    });
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
                WorkspaceDatabase.make({
                  select: () => makeQuery(rows[selectCall++] ?? []),
                } as never)
              ),
              DotyposServiceMock({
                getCustomersByIds: (ids, _readOptions) => {
                  return Effect.sync(() => {
                    customerCalls.push([...ids]);
                    return ids.map((id) => ({ id }));
                  }).pipe(
                    Effect.flatMap((records) =>
                      seededCustomerReads(records).getCustomersByIds(ids)
                    )
                  );
                },
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
                getReservationsByIds: (ids, readOptions) => {
                  if (ids.length === 0) return Effect.succeed(new Map());
                  const { concurrency, onBatchFailure, ...filters } =
                    readOptions ?? {};
                  const input = { ...filters, ids: [...ids] };
                  return Effect.sync(() => {
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
                  }).pipe(
                    Effect.flatMap((records) =>
                      seededReservationReads(records).getReservationsByIds(ids)
                    )
                  );
                },
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
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

  test("shows an early-setup meeting room's booked time and setup start", async () => {
    const instant = Temporal.Instant.from("2026-08-01T08:00:00Z");
    const reservationRow = (
      id: string,
      reservationDetails: { readonly kind: "meeting-room"; earlySetup?: true }
    ) => ({
      id: `workspace-${id}`,
      dotyposCustomerId: "customer",
      dotyposReservationId: id,
      reservationState: "confirmed",
      paymentState: "paid",
      fulfillmentState: "fulfilled",
      reservationPurpose: null,
      reservationDetails,
      reservationCreatedAt: instant,
      reservationConfirmedAt: instant,
      reservationCancelledAt: null,
      reservationHoldExpiredAt: null,
      paidAt: instant,
      fulfilledAt: instant,
      fulfillmentFailedAt: null,
      createdAt: instant,
      updatedAt: instant,
    });
    const rows = [
      [{ value: 2 }],
      [
        reservationRow("early-setup", {
          kind: "meeting-room",
          earlySetup: true,
        }),
        reservationRow("on-time", { kind: "meeting-room" }),
      ],
      [],
      [],
      [],
    ] as const;
    // Dotypos holds the early-setup room from 09:45 for a 10:00 booking.
    const heldStarts = new Map([
      ["early-setup", "2026-08-10T09:45:00.000+02:00"],
      ["on-time", "2026-08-10T10:00:00.000+02:00"],
    ]);
    let selectCall = 0;

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
                WorkspaceDatabase.make({
                  select: () => makeQuery(rows[selectCall++] ?? []),
                } as never)
              ),
              DotyposServiceMock({
                getCustomersByIds: (ids, _readOptions) => {
                  return Effect.succeed(ids.map((id) => ({ id }))).pipe(
                    Effect.flatMap((records) =>
                      seededCustomerReads(records).getCustomersByIds(ids)
                    )
                  );
                },
                listReservations: (input) =>
                  Effect.succeed(
                    (input.ids ?? []).map((id) => ({
                      _branchId: "branch",
                      _cloudId: "cloud",
                      _customerId: "customer",
                      id,
                      startDate: heldStarts.get(id) ?? "",
                      endDate: "2026-08-10T11:00:00.000+02:00",
                      seats: "1",
                      status: "CONFIRMED" as const,
                    }))
                  ),
                getReservationsByIds: (ids, readOptions) => {
                  if (ids.length === 0) return Effect.succeed(new Map());
                  const { concurrency, onBatchFailure, ...filters } =
                    readOptions ?? {};
                  const input = { ...filters, ids: [...ids] };
                  return Effect.succeed(
                    (input.ids ?? []).map((id) => ({
                      _branchId: "branch",
                      _cloudId: "cloud",
                      _customerId: "customer",
                      id,
                      startDate: heldStarts.get(id) ?? "",
                      endDate: "2026-08-10T11:00:00.000+02:00",
                      seats: "1",
                      status: "CONFIRMED" as const,
                    }))
                  ).pipe(
                    Effect.flatMap((records) =>
                      seededReservationReads(records).getReservationsByIds(ids)
                    )
                  );
                },
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    const times = result.items.map(
      ({ date, endsAt, id, setupStartsAt, startsAt }) => ({
        date,
        endsAt,
        id,
        setupStartsAt,
        startsAt,
      })
    );
    expect(times).toEqual([
      {
        date: "2026-08-10",
        endsAt: "2026-08-10T11:00:00.000+02:00",
        id: "workspace-early-setup",
        setupStartsAt: "2026-08-10T07:45:00.000Z",
        startsAt: "2026-08-10T08:00:00.000Z",
      },
      {
        date: "2026-08-10",
        endsAt: "2026-08-10T11:00:00.000+02:00",
        id: "workspace-on-time",
        setupStartsAt: null,
        startsAt: "2026-08-10T10:00:00.000+02:00",
      },
    ]);
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
                  WorkspaceDatabase.make({
                    select: () => makeQuery(rows[selectCall++] ?? []),
                  } as never)
                ),
                DotyposServiceMock({
                  getCustomer: (id) =>
                    Effect.sync(() => {
                      itemCalls.push(id);
                      return Option.some({ firstName: "Ada", id });
                    }),
                  getCustomersByIds: (ids) =>
                    (batchFails
                      ? Effect.fail(
                          new DotyposUnavailable({
                            operation: "getCustomersByIds",
                            reason: "server",
                          })
                        )
                      : Effect.succeed([])
                    ).pipe(
                      Effect.flatMap((records) =>
                        seededCustomerReads(records).getCustomersByIds(ids)
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
                reservationAuthorsMock(),
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

  test("keeps an English customer name for the API and flags an unnamed customer", async () => {
    const lastActivityAt = Temporal.Instant.from("2026-08-14T12:00:00Z");
    const rows = [
      [{ value: 2 }],
      [
        { customerId: "named-customer", reservationCount: 1, lastActivityAt },
        { customerId: "unnamed-customer", reservationCount: 1, lastActivityAt },
      ],
    ] as const;
    let selectCall = 0;

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
                WorkspaceDatabase.make({
                  select: () => makeQuery(rows[selectCall++] ?? []),
                } as never)
              ),
              DotyposServiceMock({
                getCustomersByIds: (ids) =>
                  Effect.succeed([
                    { companyName: " Acme Studio ", id: "named-customer" },
                    { companyName: " ", id: "unnamed-customer" },
                  ]).pipe(
                    Effect.flatMap((records) =>
                      seededCustomerReads(records).getCustomersByIds(ids)
                    )
                  ),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    const customerNamed = (customerId: string) =>
      result.items.find((item) => item.customerId === customerId)?.customer;
    expect(customerNamed("named-customer")).toMatchObject({
      displayName: "Acme Studio",
      hasName: true,
    });
    expect(customerNamed("unnamed-customer")).toMatchObject({
      displayName: "Unnamed customer",
      hasName: false,
    });
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
                WorkspaceDatabase.make({
                  select: () => makeQuery(rows[selectCall++] ?? []),
                } as never)
              ),
              DotyposServiceMock({
                getCustomersByIds: (ids) =>
                  Effect.fail(
                    new Error("network request interrupted", {
                      cause: interruption,
                    })
                  ).pipe(
                    Effect.flatMap((records) =>
                      seededCustomerReads(records).getCustomersByIds(ids)
                    )
                  ),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
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
      "held-today",
      "cancelled-local-today",
      "boundary-start-today",
      "boundary-end-today",
      "cancelled-only-today",
      "today-two",
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
      [
        "customer-boundary-start",
        atTime(currentDate.subtract({ days: 6 }), 0).toString(),
      ],
      [
        "customer-boundary-end",
        atTime(currentDate.add({ days: 1 }), 0).toString(),
      ],
    ]);
    const rowCustomerIds = {
      "last-week": "customer-returning",
      today: "customer-stale",
      upcoming: "customer-upcoming",
      "cancelled-today": "customer-new-a",
      "new-today": "customer-new-b",
      "failed-today": "customer-new-c",
      "held-today": "customer-held",
      "cancelled-local-today": "customer-cancelled-local",
      "boundary-start-today": "customer-boundary-start",
      "boundary-end-today": "customer-boundary-end",
      "cancelled-only-today": "customer-cancelled-only",
      "today-two": "customer-stale",
    } as const;
    const rowStates = {
      "held-today": {
        paymentState: "not_started",
        fulfillmentState: "not_started",
        reservationState: "held",
      },
      "cancelled-local-today": {
        paymentState: "not_started",
        fulfillmentState: "not_started",
        reservationState: "cancelled",
      },
    } as const;
    const rangeRows = linkedIds.map((id) => ({
      id,
      customerId: rowCustomerIds[id as keyof typeof rowCustomerIds],
      failureCode: id === "failed-today" ? "access_failed" : null,
      fulfillmentState:
        id === "failed-today"
          ? "failed"
          : (rowStates[id as keyof typeof rowStates]?.fulfillmentState ??
            "fulfilled"),
      paymentState:
        rowStates[id as keyof typeof rowStates]?.paymentState ?? "paid",
      reservationState:
        rowStates[id as keyof typeof rowStates]?.reservationState ??
        "confirmed",
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
      providerReservation("held-today", "customer-held", currentDate, 14),
      providerReservation(
        "cancelled-local-today",
        "customer-cancelled-local",
        currentDate,
        15
      ),
      providerReservation(
        "boundary-start-today",
        "customer-boundary-start",
        currentDate,
        16
      ),
      providerReservation(
        "boundary-end-today",
        "customer-boundary-end",
        currentDate,
        17
      ),
      providerReservation("today-two", "customer-new-a", currentDate, 18),
      {
        ...providerReservation(
          "cancelled-only-today",
          "customer-cancelled-only",
          currentDate,
          19
        ),
        status: "CANCELLED" as const,
      },
    ];
    const loadOverview = () =>
      Effect.gen(function* () {
        const administration = yield* AdministrationService;
        const source = yield* administration.loadOverviewSource();
        return yield* administration.loadOverview(source);
      }).pipe(
        Effect.provide(
          AdministrationService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  WorkspaceDatabase,
                  WorkspaceDatabase.make({
                    select: () => makeQuery(rangeRows),
                  } as never)
                ),
                DotyposServiceMock({
                  getCustomersByIds: (ids, _readOptions) => {
                    const options = { ids };
                    return Effect.sync(() => {
                      customerListInputs.push(options);
                      return options.ids.map((id) => ({
                        created:
                          missingCustomerCreationTime && id === "customer-new-a"
                            ? null
                            : customerCreatedAt.get(id),
                        firstName: id.replace("customer-", ""),
                        id,
                      }));
                    }).pipe(
                      Effect.flatMap((records) =>
                        seededCustomerReads(records).getCustomersByIds(ids)
                      )
                    );
                  },
                  listReservations: (input) => {
                    listInputs.push(input);
                    if (reservationsUnavailable) {
                      return Effect.fail(
                        new DotyposUnavailable({
                          operation: "listReservations",
                          reason: "server",
                        })
                      );
                    }
                    return Effect.succeed(
                      overviewReservations.filter(({ id }) =>
                        input?.ids?.includes(id)
                      )
                    );
                  },
                  getReservationsByIds: (ids, readOptions) => {
                    if (ids.length === 0) return Effect.succeed(new Map());
                    const { concurrency, onBatchFailure, ...filters } =
                      readOptions ?? {};
                    const input = { ...filters, ids: [...ids] };
                    listInputs.push(input);
                    if (reservationsUnavailable) {
                      return Effect.fail(
                        new DotyposUnavailable({
                          operation: "listReservations",
                          reason: "server",
                        })
                      ).pipe(
                        Effect.flatMap((records) =>
                          seededReservationReads(records).getReservationsByIds(
                            ids
                          )
                        )
                      );
                    }
                    return Effect.succeed(
                      overviewReservations.filter(({ id }) =>
                        input?.ids?.includes(id)
                      )
                    ).pipe(
                      Effect.flatMap((records) =>
                        seededReservationReads(records).getReservationsByIds(
                          ids
                        )
                      )
                    );
                  },
                }),
                Layer.succeed(
                  PostHogReservationHistory,
                  PostHogReservationHistory.of({
                    load: () =>
                      Effect.succeed({ kind: "unavailable" } as const),
                  })
                ),
                reservationAuthorsMock(),
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
          "customer-new-a",
          "customer-boundary-end",
          "customer-boundary-start",
          "customer-returning",
        ],
      },
    ]);
    expect(result.today).toEqual({
      completed: 4,
      unavailable: false,
      value: 10,
    });
    expect(result.upcoming).toEqual({
      completed: 1,
      unavailable: false,
      value: 1,
    });
    expect(result.lastSevenDays).toEqual({
      completed: 5,
      unavailable: false,
      value: 11,
    });
    expect(result.uniqueCustomers).toEqual({
      customers: [
        {
          customer: {
            displayName: "new-a",
            hasName: true,
            email: null,
            id: "customer-new-a",
            phone: null,
          },
          customerId: "customer-new-a",
        },
        {
          customer: {
            displayName: "boundary-end",
            hasName: true,
            email: null,
            id: "customer-boundary-end",
            phone: null,
          },
          customerId: "customer-boundary-end",
        },
        {
          customer: {
            displayName: "boundary-start",
            hasName: true,
            email: null,
            id: "customer-boundary-start",
            phone: null,
          },
          customerId: "customer-boundary-start",
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
            displayName: "new-a",
            hasName: true,
            email: null,
            id: "customer-new-a",
            phone: null,
          },
          customerId: "customer-new-a",
        },
        {
          customer: {
            displayName: "boundary-start",
            hasName: true,
            email: null,
            id: "customer-boundary-start",
            phone: null,
          },
          customerId: "customer-boundary-start",
        },
      ],
      unavailable: false,
      value: 2,
    });

    missingCustomerCreationTime = true;
    const missingCreationResult = await loadOverview();
    expect(missingCreationResult.newCustomers).toEqual({
      customers: [],
      unavailable: true,
      value: 0,
    });
    expect(missingCreationResult.uniqueCustomers).toEqual({
      customers: result.uniqueCustomers.customers,
      unavailable: false,
      value: 4,
    });

    missingCustomerCreationTime = false;
    reservationsUnavailable = true;
    const unavailableResult = await loadOverview();
    expect(unavailableResult.uniqueCustomers).toEqual({
      customers: [],
      unavailable: true,
      value: 0,
    });
    expect(unavailableResult.newCustomers).toEqual({
      customers: [],
      unavailable: true,
      value: 0,
    });
  });

  test("projects one loaded overview source without reloading its inputs", async () => {
    const reservations = [
      {
        _branchId: "branch",
        _cloudId: "cloud",
        _customerId: "customer-1",
        id: "reservation-1",
        startDate: "2026-08-12T10:00:00Z",
        endDate: "2026-08-12T11:00:00Z",
        seats: "1",
        status: "CONFIRMED" as const,
      },
    ];
    let listReservationsCalls = 0;
    let databaseQueries = 0;
    const administrationLayer = AdministrationService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            WorkspaceDatabase,
            WorkspaceDatabase.make({
              select: () => {
                databaseQueries += 1;
                return makeQuery([
                  {
                    customerId: "customer-1",
                    failureCode: null,
                    fulfillmentState: "fulfilled",
                    id: "reservation-1",
                    paymentState: "paid",
                    reservationState: "confirmed",
                  },
                ]);
              },
            } as never)
          ),
          DotyposServiceMock({
            getCustomersByIds: (ids) =>
              Effect.succeed([]).pipe(
                Effect.flatMap((records) =>
                  seededCustomerReads(records).getCustomersByIds(ids)
                )
              ),
            listReservations: () =>
              Effect.sync(() => {
                listReservationsCalls += 1;
                return reservations;
              }),
            getReservationsByIds: (ids) =>
              ids.length === 0
                ? Effect.succeed(new Map())
                : Effect.sync(() => {
                    listReservationsCalls += 1;
                    return reservations;
                  }).pipe(
                    Effect.flatMap((records) =>
                      seededReservationReads(records).getReservationsByIds(ids)
                    )
                  ),
          }),
          Layer.succeed(
            PostHogReservationHistory,
            PostHogReservationHistory.of({
              load: () => Effect.succeed({ kind: "unavailable" } as const),
            })
          ),
          reservationAuthorsMock(),
          PaymentAdministrationServiceMock({})
        )
      )
    );
    const run = <A>(effect: Effect.Effect<A, unknown, AdministrationService>) =>
      effect.pipe(Effect.provide(administrationLayer), Effect.runPromise);

    const source = await run(
      Effect.gen(function* () {
        const administration = yield* AdministrationService;
        return yield* administration.loadOverviewSource();
      })
    );
    const reservationOverview = getAdministrationReservationOverview(source);
    const overview = await run(
      Effect.gen(function* () {
        const administration = yield* AdministrationService;
        return yield* administration.loadOverview(source);
      })
    );

    expect(listReservationsCalls).toBe(1);
    // The source's linkage and early-setup details, read once.
    expect(databaseQueries).toBe(2);
    expect(overview.today).toEqual(reservationOverview.today);
    expect(overview.upcoming).toEqual(reservationOverview.upcoming);
    expect(overview.lastSevenDays).toEqual(reservationOverview.lastSevenDays);
  });

  const loadLinkedOverview = (input: {
    readonly linkedIds: readonly string[];
    readonly listReservations: DotyposService["Service"]["listReservations"];
    /** Linked bookings stored as early-setup meeting rooms. */
    readonly earlySetupIds?: readonly string[];
  }) =>
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      const source = yield* administration.loadOverviewSource();
      return { overview: yield* administration.loadOverview(source), source };
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.make({
                  select: linkageThenEarlySetupRows(
                    input.linkedIds.map((id) => ({
                      customerId: "customer",
                      failureCode: null,
                      fulfillmentState: "fulfilled",
                      id,
                      paymentState: "paid",
                      reservationState: "confirmed",
                    })),
                    input.earlySetupIds
                  ),
                } as never)
              ),
              DotyposServiceMock({
                getCustomersByIds: (ids, _readOptions) => {
                  const options = { ids };
                  return Effect.succeed(
                    options.ids.map((id) => ({
                      created: "2026-01-01T00:00:00Z",
                      firstName: id,
                      id,
                    }))
                  ).pipe(
                    Effect.flatMap((records) =>
                      seededCustomerReads(records).getCustomersByIds(ids)
                    )
                  );
                },
                listReservations: input.listReservations,
                getReservationsByIds: (ids, options) =>
                  ids.length === 0
                    ? Effect.succeed(new Map())
                    : input
                        .listReservations({ ...options, ids: [...ids] })
                        .pipe(
                          Effect.flatMap((records) =>
                            seededReservationReads(
                              records
                            ).getReservationsByIds(ids)
                          )
                        ),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

  test("reads only linked bookings for the overview source, in id batches", async () => {
    setSystemTime(new Date("2026-08-26T12:00:00Z"));
    const linkedIds = Array.from(
      { length: 51 },
      (_, index) => `booking-${String(index).padStart(2, "0")}`
    );
    const listInputs: Parameters<
      DotyposService["Service"]["listReservations"]
    >[0][] = [];

    const { source } = await loadLinkedOverview({
      linkedIds,
      listReservations: (input) =>
        Effect.sync(() => {
          listInputs.push(input);
          return (input?.ids ?? []).slice(-2).map((id) => ({
            _branchId: "branch",
            _cloudId: "cloud",
            _customerId: "customer",
            endDate: "2026-08-26T09:00:00Z",
            id,
            seats: "1",
            startDate: "2026-08-26T08:00:00Z",
            status: "CONFIRMED" as const,
          }));
        }),
    });

    expect(listInputs).toEqual([
      {
        ids: linkedIds,
        concurrency: 3,
        order: "startDateAscending",
        startsAtOrAfter: "2026-08-19T21:45:00Z",
        startsBefore: "2026-09-25T22:00:00Z",
      },
    ]);
    expect(source.rows.map(({ id }) => id)).toEqual([
      "booking-49",
      "booking-50",
    ]);
    expect(getAdministrationReservationOverview(source).today).toEqual({
      completed: 2,
      unavailable: false,
      value: 2,
    });
  });

  test("counts an early-setup meeting room on its booked date in the overview", async () => {
    setSystemTime(new Date("2026-08-26T12:00:00Z"));
    const booking = {
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: "customer",
      endDate: "2026-08-26T09:00:00Z",
      seats: "1",
      status: "CONFIRMED" as const,
    };
    // Prague is UTC+2 in August. Early setup holds a meeting room from 23:45
    // for a midnight booking.
    const bookings = [
      { ...booking, id: "booking-setup", startDate: "2026-08-25T21:45:00Z" },
      {
        ...booking,
        id: "booking-unflagged",
        startDate: "2026-08-25T21:45:00Z",
      },
    ];

    const { source } = await loadLinkedOverview({
      linkedIds: bookings.map(({ id }) => id),
      listReservations: () => Effect.succeed(bookings),

      earlySetupIds: ["booking-setup"],
    });

    expect(getAdministrationReservationOverview(source).today).toEqual({
      completed: 1,
      unavailable: false,
      value: 1,
    });
  });

  test("reports the overview source unavailable when one id batch fails", async () => {
    const { source } = await loadLinkedOverview({
      linkedIds: Array.from(
        { length: 51 },
        (_, index) => `booking-${String(index).padStart(2, "0")}`
      ),
      listReservations: (input) =>
        input?.ids?.includes("booking-50")
          ? Effect.fail(
              new DotyposUnavailable({
                operation: "listReservations",
                reason: "server",
              })
            )
          : Effect.succeed([]),
    });

    expect(source.reservations).toEqual({ kind: "unavailable" });
    expect(source.rows).toEqual([]);
  });

  test("counts a customer once across overview id batches, by their latest booking", async () => {
    setSystemTime(new Date("2026-08-26T12:00:00Z"));
    const bookings = [
      ["booking-00", "customer-a", "2026-08-26T06:00:00Z"],
      ["booking-01", "customer-b", "2026-08-26T08:00:00Z"],
      ["booking-50", "customer-a", "2026-08-26T10:00:00Z"],
    ].map(([id, customerId, startDate]) => ({
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: customerId,
      endDate: startDate,
      id,
      seats: "1",
      startDate,
      status: "CONFIRMED" as const,
    }));

    const { overview } = await loadLinkedOverview({
      linkedIds: Array.from(
        { length: 51 },
        (_, index) => `booking-${String(index).padStart(2, "0")}`
      ),
      listReservations: (input) =>
        Effect.succeed(bookings.filter(({ id }) => input?.ids?.includes(id))),
    });

    expect(overview.lastSevenDays).toEqual({
      completed: 3,
      unavailable: false,
      value: 3,
    });
    expect(overview.uniqueCustomers.value).toBe(2);
    expect(
      overview.uniqueCustomers.customers.map(({ customerId }) => customerId)
    ).toEqual(["customer-a", "customer-b"]);
  });

  test("skips the booking provider for the overview source when no Workspace reservation links a booking", async () => {
    let listCalls = 0;
    const { source } = await loadLinkedOverview({
      linkedIds: [],
      listReservations: () =>
        Effect.sync(() => {
          listCalls += 1;
          return [];
        }),
    });

    expect(source.reservations).toEqual({
      kind: "available",
      items: [],
      earlySetupDetails: new Map(),
    });
    expect(listCalls).toBe(0);
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
                WorkspaceDatabase.make({ select: () => makeQuery([]) } as never)
              ),
              DotyposServiceMock({
                getReservation: () => Effect.succeed(Option.none()),
                getTables: () => Effect.succeed([]),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBeNull();
  });

  test("propagates Dotypos failures other than a missing booking", async () => {
    const unavailable = new DotyposUnavailable({
      operation: "getReservation",
      reason: "server",
    });
    const offline = new DotyposUnavailable({
      operation: "getReservation",
      reason: "transport",
    });

    for (const [failure, operation] of [
      [unavailable, "loadBooking"],
      [unavailable, "loadBookingBreadcrumb"],
      [offline, "loadBooking"],
      [offline, "loadBookingBreadcrumb"],
    ] as const) {
      const error = await Effect.gen(function* () {
        const administration = yield* AdministrationService;
        return yield* administration[operation]("unavailable-booking");
      }).pipe(
        Effect.flip,
        Effect.provide(
          AdministrationService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  WorkspaceDatabase,
                  WorkspaceDatabase.make({
                    select: () => makeQuery([]),
                  } as never)
                ),
                DotyposServiceMock({
                  getReservation: () => Effect.fail(failure),
                  getTables: () => Effect.succeed([]),
                }),
                Layer.succeed(
                  PostHogReservationHistory,
                  PostHogReservationHistory.of({
                    load: () =>
                      Effect.succeed({ kind: "unavailable" } as const),
                  })
                ),
                reservationAuthorsMock(),
                PaymentAdministrationServiceMock({})
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(error).toBe(failure);
    }
  });

  test("loads a reservation product from only its details projection", async () => {
    const database = {
      select: () =>
        makeQuery([{ reservationDetails: { kind: "meeting-room" } }] as const),
    };

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadReservationProduct(
        "workspace-reservation"
      );
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.make(database as never)
              ),
              DotyposServiceMock({}),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toEqual({ kind: "meeting-room" });
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
                WorkspaceDatabase.make({
                  select: () => makeQuery([]),
                } as never)
              ),
              DotyposServiceMock({
                getReservation: () =>
                  Effect.succeed(
                    Option.some({
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
                    })
                  ),
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
              reservationAuthorsMock(),
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

  test("shows an early-setup meeting room's booked start in its booking breadcrumb", async () => {
    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadBookingBreadcrumb("early-setup");
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.make({
                  select: () =>
                    makeQuery([
                      {
                        dotyposReservationId: "early-setup",
                        reservationDetails: {
                          kind: "meeting-room",
                          earlySetup: true,
                        },
                      },
                    ]),
                } as never)
              ),
              DotyposServiceMock({
                getReservation: () =>
                  Effect.succeed(
                    Option.some({
                      customer: { id: "dotypos-customer" },
                      reservation: {
                        _branchId: "branch",
                        _cloudId: "cloud",
                        _customerId: "dotypos-customer",
                        _tableId: null,
                        id: "early-setup",
                        // Held from 09:45 for a 10:00 booking.
                        startDate: "2026-08-10T09:45:00+02:00",
                        endDate: "2026-08-10T11:00:00+02:00",
                        seats: "1",
                        status: "CONFIRMED",
                      },
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
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result?.startsAt).toBe("2026-08-10T08:00:00.000Z");
  });

  test("summarizes linked reservation dates through today in the Prague timezone", async () => {
    setSystemTime(new Date("2026-08-26T12:00:00Z"));
    const listInputs: unknown[] = [];
    const database = {
      select: () =>
        makeQuery([
          {
            id: "booking-one",
            dotyposReservationId: "booking-one",
            fulfillmentState: "fulfilled",
            paymentState: "paid",
            reservationState: "confirmed",
            reservationDetails: {
              kind: "cowork",
              entryTier: "basic",
              coffee: false,
            },
          },
          {
            id: "booking-two",
            dotyposReservationId: "booking-two",
            fulfillmentState: "fulfilled",
            paymentState: "paid",
            reservationState: "confirmed",
            reservationDetails: {
              kind: "cowork",
              entryTier: "plus",
              coffee: true,
            },
          },
          {
            id: "booking-profi",
            dotyposReservationId: "booking-profi",
            fulfillmentState: "fulfilled",
            paymentState: "paid",
            reservationState: "confirmed",
            reservationDetails: {
              kind: "cowork",
              entryTier: "profi",
              coffee: true,
              monitorOption: "2x27-qhd",
            },
          },
          {
            id: "booking-meeting-room",
            dotyposReservationId: "booking-meeting-room",
            fulfillmentState: "fulfilled",
            paymentState: "paid",
            reservationState: "confirmed",
            reservationDetails: { kind: "meeting-room" },
          },
          {
            id: "booking-office",
            dotyposReservationId: "booking-office",
            fulfillmentState: "fulfilled",
            paymentState: "paid",
            reservationState: "confirmed",
            reservationDetails: { kind: "office" },
          },
          {
            id: "booking-today",
            dotyposReservationId: "booking-today",
            fulfillmentState: "fulfilled",
            paymentState: "paid",
            reservationState: "confirmed",
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
                WorkspaceDatabase.make(database as never)
              ),
              DotyposServiceMock({
                listReservations: (input) =>
                  Effect.sync(() => {
                    listInputs.push(input);
                    return [
                      {
                        ...booking,
                        id: "booking-one",
                        dotyposReservationId: "booking-one",
                        startDate: "2026-08-09T22:30:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-two",
                        dotyposReservationId: "booking-two",
                        startDate: "2026-08-10T18:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-profi",
                        dotyposReservationId: "booking-profi",
                        startDate: "2026-08-11T08:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-meeting-room",
                        dotyposReservationId: "booking-meeting-room",
                        startDate: "2026-08-10T12:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-office",
                        dotyposReservationId: "booking-office",
                        startDate: "2026-08-12T08:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-not-linked",
                        dotyposReservationId: "booking-not-linked",
                        startDate: "2026-08-13T08:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-today",
                        dotyposReservationId: "booking-today",
                        startDate: "2026-08-26T14:00:00Z",
                        endDate: "2026-08-26T15:00:00Z",
                      },
                    ];
                  }),
                getReservationsByIds: (ids, readOptions) => {
                  if (ids.length === 0) return Effect.succeed(new Map());
                  const { concurrency, onBatchFailure, ...filters } =
                    readOptions ?? {};
                  const input = { ...filters, ids: [...ids] };
                  return Effect.sync(() => {
                    listInputs.push(input);
                    return [
                      {
                        ...booking,
                        id: "booking-one",
                        dotyposReservationId: "booking-one",
                        startDate: "2026-08-09T22:30:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-two",
                        dotyposReservationId: "booking-two",
                        startDate: "2026-08-10T18:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-profi",
                        dotyposReservationId: "booking-profi",
                        startDate: "2026-08-11T08:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-meeting-room",
                        dotyposReservationId: "booking-meeting-room",
                        startDate: "2026-08-10T12:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-office",
                        dotyposReservationId: "booking-office",
                        startDate: "2026-08-12T08:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-not-linked",
                        dotyposReservationId: "booking-not-linked",
                        startDate: "2026-08-13T08:00:00Z",
                      },
                      {
                        ...booking,
                        id: "booking-today",
                        dotyposReservationId: "booking-today",
                        startDate: "2026-08-26T14:00:00Z",
                        endDate: "2026-08-26T15:00:00Z",
                      },
                    ];
                  }).pipe(
                    Effect.flatMap((records) =>
                      seededReservationReads(records).getReservationsByIds(ids)
                    )
                  );
                },
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
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
          .subtract({ minutes: 15 })
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
                WorkspaceDatabase.make({ select: () => makeQuery([]) } as never)
              ),
              DotyposServiceMock({
                listReservations: () =>
                  Effect.fail(
                    new DotyposUnavailable({
                      operation: "listReservations",
                      reason: "server",
                    })
                  ),
                getReservationsByIds: (ids) =>
                  ids.length === 0
                    ? Effect.succeed(new Map())
                    : Effect.fail(
                        new DotyposUnavailable({
                          operation: "listReservations",
                          reason: "server",
                        })
                      ).pipe(
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
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result.dates).toBeNull();
  });

  type OverviewReservationActivityInput = {
    readonly linkedIds: readonly string[];
    readonly listReservations: DotyposService["Service"]["listReservations"];
    /** Linked bookings stored as early-setup meeting rooms. */
    readonly earlySetupIds?: readonly string[];
  };

  const provideOverviewReservationActivity = (
    input: OverviewReservationActivityInput
  ) =>
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadReservationActivity();
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.make({
                  select: linkageThenEarlySetupRows(
                    input.linkedIds.map((id) => ({ id })),
                    input.earlySetupIds
                  ),
                } as never)
              ),
              DotyposServiceMock({
                listReservations: input.listReservations,
                getReservationsByIds: (ids, options) =>
                  ids.length === 0
                    ? Effect.succeed(new Map())
                    : input
                        .listReservations({ ...options, ids: [...ids] })
                        .pipe(
                          Effect.flatMap((records) =>
                            seededReservationReads(
                              records
                            ).getReservationsByIds(ids)
                          )
                        ),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      )
    );

  const loadOverviewReservationActivity = (
    input: OverviewReservationActivityInput
  ) => Effect.runPromise(provideOverviewReservationActivity(input));

  test("dies when Dotypos lists a reservation with an unreadable start", async () => {
    setSystemTime(new Date("2026-08-26T12:00:00Z"));
    const booking = {
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: "dotypos-customer",
      id: "booking-unreadable",
      endDate: "2026-08-10T23:00:00Z",
      seats: "1",
      status: "CONFIRMED" as const,
    };

    for (const startDate of ["not-a-date", "2026-02-30T08:00:00Z"]) {
      const exit = await Effect.runPromiseExit(
        provideOverviewReservationActivity({
          linkedIds: [booking.id],
          listReservations: () => Effect.succeed([{ ...booking, startDate }]),
        })
      );

      expect(
        Exit.isFailure(exit) &&
          Cause.hasDies(exit.cause) &&
          !Cause.hasFails(exit.cause)
      ).toBe(true);
    }
  });

  test("counts every linked reservation in the overview reservation activity", async () => {
    setSystemTime(new Date("2026-08-26T12:00:00Z"));
    const listInputs: unknown[] = [];
    const booking = {
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: "dotypos-customer",
      endDate: "2026-08-10T23:00:00Z",
      seats: "1",
    };
    const bookings = [
      {
        ...booking,
        id: "booking-confirmed",
        startDate: "2026-08-09T22:30:00Z",
        status: "CONFIRMED" as const,
      },
      {
        ...booking,
        id: "booking-new",
        startDate: "2026-08-10T08:00:00Z",
        status: "NEW" as const,
      },
      {
        ...booking,
        id: "booking-cancelled",
        startDate: "2026-08-10T18:00:00Z",
        status: "CANCELLED" as const,
      },
      {
        ...booking,
        id: "booking-not-linked",
        startDate: "2026-08-10T12:00:00Z",
        status: "CONFIRMED" as const,
      },
      {
        ...booking,
        id: "booking-other-day",
        startDate: "2026-08-12T08:00:00Z",
        status: "CONFIRMED" as const,
      },
    ];

    const result = await loadOverviewReservationActivity({
      linkedIds: [
        "booking-other-day",
        "booking-confirmed",
        "booking-new",
        "booking-cancelled",
      ],
      listReservations: (input) =>
        Effect.sync(() => {
          listInputs.push(input);
          return bookings.filter(({ id }) => input?.ids?.includes(id));
        }),
    });

    expect(listInputs).toEqual([
      {
        concurrency: 3,
        ids: [
          "booking-cancelled",
          "booking-confirmed",
          "booking-new",
          "booking-other-day",
        ],
        startsAtOrAfter: "2025-08-26T21:45:00Z",
        startsBefore: "2026-08-26T22:00:00Z",
        order: "startDateAscending",
      },
    ]);
    expect(result).toEqual({
      from: "2025-08-27",
      to: "2026-08-26",
      dates: [
        { count: 3, date: "2026-08-10" },
        { count: 1, date: "2026-08-12" },
      ],
    });
  });

  test("dates an early-setup meeting room in the overview reservation activity by its booked start", async () => {
    setSystemTime(new Date("2026-08-26T12:00:00Z"));
    const booking = {
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: "dotypos-customer",
      endDate: "2026-08-10T23:00:00Z",
      seats: "1",
      status: "CONFIRMED" as const,
    };
    // Prague is UTC+2 in August. Early setup holds a meeting room from 23:45
    // for a midnight booking.
    const bookings = [
      {
        ...booking,
        id: "booking-setup-from-range-start",
        startDate: "2025-08-26T21:45:00Z",
      },
      {
        ...booking,
        id: "booking-before-range",
        startDate: "2025-08-26T21:45:00Z",
      },
      {
        ...booking,
        id: "booking-setup-midnight",
        startDate: "2026-08-09T21:45:00Z",
      },
      {
        ...booking,
        id: "booking-unflagged-midnight",
        startDate: "2026-08-09T21:45:00Z",
      },
    ];

    const result = await loadOverviewReservationActivity({
      linkedIds: bookings.map(({ id }) => id),
      listReservations: () => Effect.succeed(bookings),

      earlySetupIds: [
        "booking-setup-from-range-start",
        "booking-setup-midnight",
      ],
    });

    expect(result.dates).toEqual([
      { count: 1, date: "2025-08-27" },
      { count: 1, date: "2026-08-09" },
      { count: 1, date: "2026-08-10" },
    ]);
  });

  test("reads only linked bookings for the overview reservation activity, in id batches", async () => {
    setSystemTime(new Date("2026-08-26T12:00:00Z"));
    const linkedIds = Array.from(
      { length: 51 },
      (_, index) => `booking-${String(index).padStart(2, "0")}`
    );
    const requestedIds: (readonly string[] | undefined)[] = [];

    const result = await loadOverviewReservationActivity({
      linkedIds,
      listReservations: (input) =>
        Effect.sync(() => {
          requestedIds.push(input?.ids);
          const returnedIds = input?.ids?.slice(-2) ?? [];
          return returnedIds.map((id) => ({
            _branchId: "branch",
            _cloudId: "cloud",
            _customerId: "dotypos-customer",
            endDate: "2026-08-10T23:00:00Z",
            id,
            seats: "1",
            startDate: "2026-08-10T08:00:00Z",
            status: "CONFIRMED" as const,
          }));
        }),
    });

    expect(requestedIds).toEqual([linkedIds]);
    expect(result.dates).toEqual([{ count: 2, date: "2026-08-10" }]);
  });

  test("reports the overview reservation activity unavailable when one id batch fails", async () => {
    const linkedIds = Array.from(
      { length: 51 },
      (_, index) => `booking-${String(index).padStart(2, "0")}`
    );

    const result = await loadOverviewReservationActivity({
      linkedIds,
      listReservations: (input) =>
        input?.ids?.includes("booking-50")
          ? Effect.fail(
              new DotyposUnavailable({
                operation: "listReservations",
                reason: "server",
              })
            )
          : Effect.succeed([]),
    });

    expect(result.dates).toBeNull();
  });

  test("skips the booking provider when no Workspace reservation links a booking", async () => {
    let listCalls = 0;
    const result = await loadOverviewReservationActivity({
      linkedIds: [],
      listReservations: () =>
        Effect.sync(() => {
          listCalls += 1;
          return [];
        }),
    });

    expect(result.dates).toEqual([]);
    expect(listCalls).toBe(0);
  });

  test("keeps unavailable overview reservation activity distinct from no activity", async () => {
    const result = await loadOverviewReservationActivity({
      linkedIds: ["booking-confirmed"],
      listReservations: () =>
        Effect.fail(
          new DotyposUnavailable({
            operation: "listReservations",
            reason: "server",
          })
        ),
    });

    expect(result.dates).toBeNull();
  });

  test("counts only completed reservations in customer reservation activity", async () => {
    setSystemTime(new Date("2026-08-26T12:00:00Z"));
    const listInputs: unknown[] = [];
    const completedRow = {
      fulfillmentState: "fulfilled",
      paymentState: "paid",
      reservationState: "confirmed",
    } as const;
    const database = {
      select: () =>
        makeQuery([
          {
            id: "booking-pending",
            dotyposReservationId: "booking-pending",
            ...completedRow,
            fulfillmentState: "not_started",
            reservationDetails: {
              kind: "cowork",
              entryTier: "basic",
              coffee: false,
            },
          },
          {
            id: "booking-cancelled",
            dotyposReservationId: "booking-cancelled",
            ...completedRow,
            reservationState: "cancelled",
            reservationDetails: { kind: "meeting-room" },
          },
          {
            id: "booking-cancelling",
            dotyposReservationId: "booking-cancelling",
            ...completedRow,
            reservationState: "cancelling",
            reservationDetails: { kind: "meeting-room" },
          },
          {
            id: "booking-cancellation-failed",
            dotyposReservationId: "booking-cancellation-failed",
            ...completedRow,
            reservationState: "cancellation_failed",
            reservationDetails: { kind: "meeting-room" },
          },
          {
            id: "booking-provider-cancelled",
            dotyposReservationId: "booking-provider-cancelled",
            ...completedRow,
            reservationDetails: { kind: "office" },
          },
          {
            id: "booking-provider-new",
            dotyposReservationId: "booking-provider-new",
            ...completedRow,
            reservationDetails: { kind: "office" },
          },
          {
            id: "booking-today",
            dotyposReservationId: "booking-today",
            ...completedRow,
            reservationDetails: {
              kind: "cowork",
              entryTier: "plus",
              coffee: true,
            },
          },
          {
            id: "booking-mixed-cowork",
            dotyposReservationId: "booking-mixed-cowork",
            ...completedRow,
            reservationDetails: {
              kind: "cowork",
              entryTier: "plus",
              coffee: true,
            },
          },
          {
            id: "booking-mixed-meeting-room",
            dotyposReservationId: "booking-mixed-meeting-room",
            ...completedRow,
            reservationDetails: { kind: "meeting-room" },
          },
          {
            id: "booking-mixed-office",
            dotyposReservationId: "booking-mixed-office",
            ...completedRow,
            reservationDetails: { kind: "office" },
          },
          {
            id: "booking-baseline",
            dotyposReservationId: "booking-baseline",
            ...completedRow,
            reservationDetails: {
              kind: "cowork",
              entryTier: "basic",
              coffee: false,
            },
          },
          {
            id: "booking-setup-from-range-start",
            dotyposReservationId: "booking-setup-from-range-start",
            ...completedRow,
            reservationDetails: { kind: "meeting-room", earlySetup: true },
          },
          {
            id: "booking-before-range",
            dotyposReservationId: "booking-before-range",
            ...completedRow,
            reservationDetails: { kind: "meeting-room" },
          },
          {
            id: "booking-setup-midnight",
            dotyposReservationId: "booking-setup-midnight",
            ...completedRow,
            reservationDetails: { kind: "meeting-room", earlySetup: true },
          },
          {
            id: "booking-unflagged-midnight",
            dotyposReservationId: "booking-unflagged-midnight",
            ...completedRow,
            reservationDetails: { kind: "meeting-room" },
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
    const providerBookings = [
      { ...booking, id: "booking-pending", startDate: "2026-08-09T22:30:00Z" },
      {
        ...booking,
        id: "booking-cancelled",
        dotyposReservationId: "booking-cancelled",
        startDate: "2026-08-10T08:00:00Z",
      },
      {
        ...booking,
        id: "booking-cancelling",
        dotyposReservationId: "booking-cancelling",
        startDate: "2026-08-10T09:00:00Z",
      },
      {
        ...booking,
        id: "booking-cancellation-failed",
        dotyposReservationId: "booking-cancellation-failed",
        startDate: "2026-08-10T10:00:00Z",
      },
      {
        ...booking,
        id: "booking-provider-cancelled",
        dotyposReservationId: "booking-provider-cancelled",
        startDate: "2026-08-11T08:00:00Z",
        status: "CANCELLED" as const,
      },
      {
        ...booking,
        id: "booking-provider-new",
        dotyposReservationId: "booking-provider-new",
        startDate: "2026-08-11T09:00:00Z",
        status: "NEW" as const,
      },
      {
        ...booking,
        id: "booking-today",
        dotyposReservationId: "booking-today",
        startDate: "2026-08-26T14:00:00Z",
        endDate: "2026-08-26T15:00:00Z",
      },
      {
        ...booking,
        id: "booking-mixed-cowork",
        dotyposReservationId: "booking-mixed-cowork",
        startDate: "2026-08-12T08:00:00Z",
      },
      {
        ...booking,
        id: "booking-mixed-meeting-room",
        dotyposReservationId: "booking-mixed-meeting-room",
        startDate: "2026-08-12T12:00:00Z",
      },
      {
        ...booking,
        id: "booking-mixed-office",
        dotyposReservationId: "booking-mixed-office",
        startDate: "2026-08-12T16:00:00Z",
      },
      {
        ...booking,
        id: "booking-baseline",
        dotyposReservationId: "booking-baseline",
        startDate: "2026-08-13T08:00:00Z",
      },
      // Prague is UTC+2 in August. Early setup holds these meeting rooms from
      // 23:45 for a midnight booking.
      {
        ...booking,
        id: "booking-setup-from-range-start",
        dotyposReservationId: "booking-setup-from-range-start",
        startDate: "2025-08-26T21:45:00Z",
      },
      {
        ...booking,
        id: "booking-before-range",
        dotyposReservationId: "booking-before-range",
        startDate: "2025-08-26T21:50:00Z",
      },
      {
        ...booking,
        id: "booking-setup-midnight",
        dotyposReservationId: "booking-setup-midnight",
        startDate: "2026-08-13T21:45:00Z",
      },
      {
        ...booking,
        id: "booking-unflagged-midnight",
        dotyposReservationId: "booking-unflagged-midnight",
        startDate: "2026-08-15T21:45:00Z",
      },
    ];

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
                WorkspaceDatabase.make(database as never)
              ),
              DotyposServiceMock({
                listReservations: (input) =>
                  Effect.sync(() => {
                    listInputs.push(input);
                    return providerBookings;
                  }),
                getReservationsByIds: (ids, readOptions) => {
                  if (ids.length === 0) return Effect.succeed(new Map());
                  const { concurrency, onBatchFailure, ...filters } =
                    readOptions ?? {};
                  const input = { ...filters, ids: [...ids] };
                  return Effect.sync(() => {
                    listInputs.push(input);
                    return providerBookings;
                  }).pipe(
                    Effect.flatMap((records) =>
                      seededReservationReads(records).getReservationsByIds(ids)
                    )
                  );
                },
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
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
          .subtract({ minutes: 15 })
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
        { category: "meeting-room", count: 1, date: "2025-08-27" },
        { category: "office", count: 3, date: "2026-08-12" },
        { category: "cowork-basic", count: 1, date: "2026-08-13" },
        { category: "meeting-room", count: 1, date: "2026-08-14" },
        { category: "meeting-room", count: 1, date: "2026-08-15" },
        { category: "cowork-plus", count: 1, date: "2026-08-26" },
      ],
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
                WorkspaceDatabase.make(database as never)
              ),
              DotyposServiceMock({}),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(),
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

describe("AdministrationService reservation author", () => {
  const customerId = DotyposCustomerIdSchema.make("booked-for-customer");
  const authorCustomerId = DotyposCustomerIdSchema.make("author-customer");
  const authorAccountId = customerAccountIdSchema.make("author-account");
  const authorEmail = testEmailAddress("administration-author");
  const now = Temporal.Instant.from("2026-10-17T08:00:00Z");

  const loadAuthor = async ({
    accountId,
    describe,
  }: {
    readonly accountId: CustomerAccountId;
    readonly describe: ReservationAuthorDirectory["Service"]["describe"];
  }) => {
    let selectCall = 0;
    const row = {
      id: workspaceReservationIdSchema.make("authored-reservation"),
      authorAccountId: accountId,
      dotyposCustomerId: customerId,
      dotyposReservationId: null,
      reservationState: "draft",
      paymentState: "not_started",
      fulfillmentState: "not_started",
      reservationDetails: {
        kind: "cowork",
        entryTier: "open-space",
        coffee: false,
      },
      reservationPurpose: null,
      reservationCreatedAt: null,
      reservationConfirmedAt: null,
      reservationCancelledAt: null,
      reservationHoldExpiredAt: null,
      paidAt: null,
      fulfilledAt: null,
      fulfillmentFailedAt: null,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    };
    const detail = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadReservation(row.id);
    }).pipe(
      Effect.provide(
        AdministrationService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.make(
                  // The reservation is the first read; its related rows are empty.
                  {
                    select: () => makeQuery(selectCall++ === 0 ? [row] : []),
                  } as never
                )
              ),
              DotyposServiceMock({
                getCustomer: (id) =>
                  Effect.succeed(
                    Option.some({ id, firstName: "Bea", lastName: "Booked" })
                  ),
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
                listReservations: () => Effect.succeed([]),
                getReservationsByIds: (ids) =>
                  ids.length === 0
                    ? Effect.succeed(new Map())
                    : Effect.succeed([]).pipe(
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
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              reservationAuthorsMock(describe),
              PaymentAdministrationServiceMock({
                loadReservationOrders: () => Effect.succeed([]),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );
    expect(detail?.reservation.customer?.displayName).toBe("Bea Booked");
    return detail?.author;
  };

  const describing =
    (
      author: ReservationAuthor
    ): ReservationAuthorDirectory["Service"]["describe"] =>
    () =>
      Effect.succeed(new Map([[author.accountId, author]]));

  test("shows no author when the customer booked for themselves", async () => {
    const author = await loadAuthor({
      accountId: authorAccountId,
      describe: describing({
        kind: "active",
        accountId: authorAccountId,
        dotyposCustomerId: customerId,
        email: authorEmail,
        locale: null,
      }),
    });

    expect(author).toBeNull();
  });

  test("names the account that booked for someone else by its own customer and login email", async () => {
    const author = await loadAuthor({
      accountId: authorAccountId,
      describe: describing({
        kind: "active",
        accountId: authorAccountId,
        dotyposCustomerId: authorCustomerId,
        email: authorEmail,
        locale: "cs-CZ",
      }),
    });

    expect(author).toEqual({
      kind: "account",
      customerId: authorCustomerId,
      displayName: "Ada Author",
      hasName: true,
      email: authorEmail,
    });
  });

  test("names an author without a linked customer as unnamed", async () => {
    const author = await loadAuthor({
      accountId: authorAccountId,
      describe: describing({
        kind: "active",
        accountId: authorAccountId,
        dotyposCustomerId: null,
        email: authorEmail,
        locale: null,
      }),
    });

    expect(author).toEqual({
      kind: "account",
      customerId: null,
      displayName: "Unnamed customer",
      hasName: false,
      email: authorEmail,
    });
  });

  test("shows only that a deleted author was deleted", async () => {
    const author = await loadAuthor({
      accountId: authorAccountId,
      describe: describing({ kind: "deleted", accountId: authorAccountId }),
    });

    expect(author).toEqual({ kind: "deleted" });
  });

  test("keeps the reservation available when its author can't be read", async () => {
    const author = await loadAuthor({
      accountId: authorAccountId,
      describe: () =>
        Effect.fail(
          new ReservationAuthorReadError({ code: "reservation-author.read" })
        ),
    });

    expect(author).toEqual({ kind: "unavailable" });
  });
});
