import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { ExternalAPIError } from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { Effect, Layer, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { ReservationAuthorDirectory } from "@/features/account";
import { AdministrationService } from "./administration.service";
import { PaymentAdministrationServiceMock } from "./payment-administration.service.mock";
import { PostHogReservationHistory } from "./posthog-reservation-history";

type DotyposOverrides = Parameters<typeof DotyposServiceMock>[0];

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

const instant = Temporal.Instant.from("2026-08-10T08:00:00Z");

const makeRow = (index: number) =>
  ({
    id: `workspace-reservation-${index}`,
    dotyposCustomerId: `dotypos-customer-${index % 3}`,
    dotyposReservationId: `dotypos-reservation-${index}`,
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
    failureCode: null,
    createdAt: instant,
    updatedAt: instant,
  }) as const;

const makeBooking = (index: number, startDate = "2026-08-20T08:00:00Z") => ({
  id: `dotypos-reservation-${index}`,
  _customerId: `dotypos-customer-${index % 3}`,
  startDate,
  endDate: "2026-08-20T10:00:00Z",
  status: "CONFIRMED",
});

const providerUnavailable = () =>
  Effect.fail(
    new ExternalAPIError({
      operation: "listReservations",
      service: "Dotypos",
      statusCode: 503,
    })
  );

const customerNotFound = () =>
  Effect.fail(
    new ExternalAPIError({
      operation: "getCustomer",
      service: "Dotypos",
      statusCode: 404,
    })
  );

const customersFor = ({ ids }: { readonly ids: readonly string[] }) =>
  Effect.succeed(
    ids.map((id) => ({ id, firstName: "Synthetic", lastName: id }))
  );

/**
 * Runs one service call over in-memory database reads, answered in call
 * order, and the given Dotypos behaviour.
 */
const runAdministration = <A, E>(
  {
    dotypos,
    selects,
  }: {
    readonly dotypos: DotyposOverrides;
    readonly selects: readonly (readonly unknown[])[];
  },
  operation: (
    administration: typeof AdministrationService.Service
  ) => Effect.Effect<A, E>
) => {
  let selectCall = 0;
  const database = {
    select: () => makeQuery(selects[selectCall++] ?? []),
  };
  return Effect.gen(function* () {
    return yield* operation(yield* AdministrationService);
  }).pipe(
    Effect.provide(
      AdministrationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(
              WorkspaceDatabase,
              WorkspaceDatabase.of({ db: database as never })
            ),
            DotyposServiceMock(dotypos),
            Layer.succeed(
              PostHogReservationHistory,
              PostHogReservationHistory.of({
                load: () => Effect.succeed({ kind: "unavailable" } as const),
              })
            ),
            Layer.succeed(
              ReservationAuthorDirectory,
              ReservationAuthorDirectory.of({
                describe: () => Effect.succeed(new Map()),
              })
            ),
            PaymentAdministrationServiceMock({})
          )
        )
      )
    ),
    Effect.runPromise,
    (result) => result.then((value) => ({ selectCalls: selectCall, value }))
  );
};

// Rows, then the payment attempts, late payments, and recoveries of the rows.
const exportSelects = (rows: readonly unknown[]) => [rows, [], [], []];

describe("AdministrationService.exportReservations", () => {
  test("exports every matching reservation past one page, reading bookings in batches", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => makeRow(index));
    const bookingReads: (readonly string[])[] = [];

    const { value: exported } = await runAdministration(
      {
        dotypos: {
          getCustomers: customersFor,
          listReservations: ({ ids }) =>
            Effect.sync(() => {
              bookingReads.push(ids ?? []);
              return (ids ?? []).map((id) =>
                makeBooking(Number(id.replace("dotypos-reservation-", "")))
              );
            }),
        },
        selects: exportSelects(rows),
      },
      (administration) =>
        administration.exportReservations({
          direction: "desc",
          sort: "created",
        })
    );

    expect(exported.map(({ id }) => id)).toEqual(rows.map(({ id }) => id));
    expect(bookingReads.map((ids) => ids.length)).toEqual([50, 10]);
    expect(exported[59]).toMatchObject({
      dotyposReservationId: "dotypos-reservation-59",
      customerId: "dotypos-customer-2",
      customer: { displayName: "Synthetic dotypos-customer-2" },
      startsAt: "2026-08-20T08:00:00Z",
    });
  });

  test("orders a date sort by the Dotypos booking order", async () => {
    const rows = [makeRow(1), makeRow(2), makeRow(3)];

    const { value: exported } = await runAdministration(
      {
        dotypos: {
          getCustomers: customersFor,
          listReservations: () =>
            Effect.succeed([
              makeBooking(3, "2026-08-02T08:00:00Z"),
              makeBooking(1, "2026-08-03T08:00:00Z"),
              makeBooking(2, "2026-08-04T08:00:00Z"),
            ]),
        },
        selects: [
          rows.map(({ id, dotyposReservationId }) => ({
            id,
            externalId: dotyposReservationId,
          })),
          rows,
          [],
          [],
          [],
        ],
      },
      (administration) =>
        administration.exportReservations({
          direction: "desc",
          from: "2026-08-01",
          sort: "date",
        })
    );

    expect(exported.map(({ id }) => id)).toEqual([
      "workspace-reservation-2",
      "workspace-reservation-1",
      "workspace-reservation-3",
    ]);
  });

  test("keeps a reservation whose booking or customer Dotypos doesn't have", async () => {
    const { value: exported } = await runAdministration(
      {
        dotypos: {
          getCustomer: customerNotFound,
          getCustomers: () => Effect.succeed([]),
          listReservations: () => Effect.succeed([]),
        },
        selects: exportSelects([makeRow(1)]),
      },
      (administration) => administration.exportReservations({})
    );

    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ customer: null, startsAt: null });
  });

  describe("fails instead of degrading when Dotypos is unavailable", () => {
    const cases = [
      {
        name: "the date range",
        input: { from: "2026-08-01" },
        dotypos: { listReservations: providerUnavailable },
        source: "booking-dates",
      },
      {
        name: "the date order",
        input: { sort: "date" },
        dotypos: { listReservations: providerUnavailable },
        source: "booking-dates",
      },
      {
        name: "booking details",
        input: {},
        dotypos: {
          getCustomers: customersFor,
          listReservations: providerUnavailable,
        },
        source: "booking-details",
      },
      {
        name: "customer details",
        input: {},
        dotypos: {
          getCustomer: () => Effect.die("no single-record fallback"),
          getCustomers: providerUnavailable,
          listReservations: () => Effect.succeed([makeBooking(1)]),
        },
        source: "customer-details",
      },
    ] as const;

    for (const { dotypos, input, name, source } of cases) {
      test(name, async () => {
        const { value: failure } = await runAdministration(
          {
            dotypos,
            selects: exportSelects([makeRow(1)]),
          },
          (administration) =>
            administration.exportReservations(input).pipe(Effect.flip)
        );

        expect(failure).toMatchObject({
          _tag: "AdministrationListSourceUnavailableError",
          source,
        });
      });
    }
  });

  describe("reads a customer a successful batch left out on its own", () => {
    const exportOne = (getCustomer: DotyposOverrides["getCustomer"]) => {
      const singleReads: string[] = [];
      return runAdministration(
        {
          dotypos: {
            getCustomer: (id) =>
              Effect.suspend(() => {
                singleReads.push(id);
                return getCustomer?.(id) ?? Effect.die("no single read");
              }),
            // The batch answers for the first customer only.
            getCustomers: ({ ids }) =>
              customersFor({
                ids: ids.filter((id) => id === "dotypos-customer-1"),
              }),
            listReservations: () =>
              Effect.succeed([makeBooking(1), makeBooking(2)]),
          },
          selects: exportSelects([makeRow(1), makeRow(2)]),
        },
        (administration) =>
          administration.exportReservations({}).pipe(Effect.result)
      ).then(({ value }) => ({ result: value, singleReads }));
    };

    test("and exports the customer it returns", async () => {
      const { result, singleReads } = await exportOne((id) =>
        Effect.succeed({ id, firstName: "Single", lastName: id })
      );

      expect(singleReads).toEqual(["dotypos-customer-2"]);
      expect(Result.getOrThrow(result).map(({ customer }) => customer)).toEqual(
        [
          expect.objectContaining({
            displayName: "Synthetic dotypos-customer-1",
          }),
          expect.objectContaining({ displayName: "Single dotypos-customer-2" }),
        ]
      );
    });

    test("and leaves a customer Dotypos doesn't have empty", async () => {
      const { result } = await exportOne(customerNotFound);

      expect(
        Result.getOrThrow(result).map(({ customer }) => customer?.id ?? null)
      ).toEqual(["dotypos-customer-1", null]);
    });

    test("and fails when that read fails", async () => {
      const { result } = await exportOne(providerUnavailable);

      expect(Result.isFailure(result) && result.failure).toMatchObject({
        _tag: "AdministrationListSourceUnavailableError",
        source: "customer-details",
      });
    });
  });
});

describe("AdministrationService.exportCustomers", () => {
  const customerRow = (id: string) => ({
    customerId: id,
    marketingConsent: "granted",
    reservationCount: 2,
    lastActivityAt: instant,
  });

  const exportTwo = (
    dotypos: Pick<DotyposOverrides, "getCustomer" | "getCustomers">
  ) =>
    runAdministration(
      {
        dotypos: {
          listReservations: () => Effect.die("no date range"),
          ...dotypos,
        },
        selects: [
          [
            customerRow("dotypos-customer-1"),
            customerRow("dotypos-customer-2"),
          ],
        ],
      },
      (administration) =>
        administration
          .exportCustomers({ marketingConsent: "granted" })
          .pipe(Effect.result)
    ).then(({ value }) => value);

  // The batch answers for the first customer only.
  const firstCustomerOnly: DotyposOverrides["getCustomers"] = ({ ids }) =>
    customersFor({ ids: ids.filter((id) => id === "dotypos-customer-1") });

  test("reads a customer the batch left out on its own", async () => {
    const result = await exportTwo({
      getCustomer: (id) =>
        Effect.succeed({ id, firstName: "Single", lastName: id }),
      getCustomers: firstCustomerOnly,
    });

    expect(
      Result.getOrThrow(result).map(({ customer, customerId }) => [
        customerId,
        customer?.displayName,
      ])
    ).toEqual([
      ["dotypos-customer-1", "Synthetic dotypos-customer-1"],
      ["dotypos-customer-2", "Single dotypos-customer-2"],
    ]);
  });

  test("keeps a customer Dotypos doesn't have, without details", async () => {
    const result = await exportTwo({
      getCustomer: customerNotFound,
      getCustomers: firstCustomerOnly,
    });

    expect(
      Result.getOrThrow(result).map(({ customer }) => customer?.id ?? null)
    ).toEqual(["dotypos-customer-1", null]);
  });

  for (const { name, dotypos } of [
    {
      name: "the customer batch fails",
      dotypos: {
        getCustomer: () => Effect.die("no single-record fallback"),
        getCustomers: providerUnavailable,
      },
    },
    {
      name: "the single read of a left-out customer fails",
      dotypos: {
        getCustomer: providerUnavailable,
        getCustomers: firstCustomerOnly,
      },
    },
  ] as const) {
    test(`fails when ${name}`, async () => {
      const result = await exportTwo(dotypos);

      expect(Result.isFailure(result) && result.failure).toMatchObject({
        _tag: "AdministrationListSourceUnavailableError",
        source: "customer-details",
      });
    });
  }
});

describe("AdministrationService.listReservations under the same Dotypos failures", () => {
  test("still shows the date filter as unavailable", async () => {
    const { value: page } = await runAdministration(
      {
        dotypos: { listReservations: providerUnavailable },
        selects: [[{ value: 0 }], []],
      },
      (administration) =>
        administration.listReservations({ from: "2026-08-01" })
    );

    expect(page).toMatchObject({ dateFilterUnavailable: true, total: 0 });
  });

  test("still shows rows without booking details", async () => {
    const { value: page } = await runAdministration(
      {
        dotypos: {
          getCustomers: customersFor,
          listReservations: providerUnavailable,
        },
        selects: [[{ value: 1 }], [makeRow(1)], [], [], []],
      },
      (administration) => administration.listReservations({})
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      liveDetailsAvailable: false,
      customer: { displayName: "Synthetic dotypos-customer-1" },
    });
  });

  test("still reads customers one by one when a batch fails", async () => {
    const singleReads: string[] = [];
    const { value: page } = await runAdministration(
      {
        dotypos: {
          getCustomer: (id) =>
            Effect.sync(() => {
              singleReads.push(id);
              return { id, firstName: "Single", lastName: id };
            }),
          getCustomers: providerUnavailable,
          listReservations: () => Effect.succeed([makeBooking(1)]),
        },
        selects: [[{ value: 1 }], [makeRow(1)], [], [], []],
      },
      (administration) => administration.listReservations({})
    );

    expect(singleReads).toEqual(["dotypos-customer-1"]);
    expect(page.items[0]?.customer).toMatchObject({
      displayName: "Single dotypos-customer-1",
    });
  });

  test("still shows a row without customer details when the single read fails too", async () => {
    const { value: page } = await runAdministration(
      {
        dotypos: {
          getCustomer: providerUnavailable,
          getCustomers: () => Effect.succeed([]),
          listReservations: () => Effect.succeed([makeBooking(1)]),
        },
        selects: [[{ value: 1 }], [makeRow(1)], [], [], []],
      },
      (administration) => administration.listReservations({})
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.customer).toBeNull();
  });
});
