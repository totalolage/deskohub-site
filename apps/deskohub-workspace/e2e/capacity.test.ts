import { afterEach, expect, setSystemTime, test } from "bun:test";
import type { Reservation } from "@deskohub/dotypos";
import type { Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import {
  getWorkspaceE2ECandidateDate,
  isWorkspaceE2EAllocatedWeekday,
} from "./allocation";
import {
  getWorkspaceE2ECapacityFailures,
  getWorkspaceE2ECapacityInterval,
  getWorkspaceE2EDateInterval,
  makeWorkspaceE2ECapacityReport,
  makeWorkspaceE2ELegacyTierCleanupCapacityReport,
  workspaceE2ELegacyTierCleanupCapacityGroups,
  workspaceE2EMaximumSameDateCoworkReservations,
} from "./capacity";
import { makeWorkspaceE2ECases, type WorkspaceE2EPreparation } from "./cases";
import {
  makeDiscountE2ECases,
  prepareDiscountAvailabilityE2E,
} from "./cases/discounts";
import { meetingRoomE2EDurations } from "./cases/meeting-room";
import { selectCoworkDates } from "./checkout/data";
import type { DatasourceConfig, WorkspaceE2EConfig } from "./config";
import type { E2EDotyposDiscountGroup } from "./integrations/dotypos";
import type { Runner } from "./runtime";
import { workspaceE2ETimeouts } from "./timeouts";

afterEach(() => setSystemTime());

test("covers whole Prague dates at both candidate-range boundaries", () => {
  expect(
    getWorkspaceE2ECapacityInterval(new Date("2026-08-04T17:45:00.000Z"))
  ).toEqual({
    endDate: new Date("2026-11-02T23:00:00.000Z"),
    startDate: new Date("2026-08-17T22:00:00.000Z"),
  });
});

test("builds an owned-date interval across Prague's DST boundary", () => {
  expect(
    getWorkspaceE2EDateInterval({
      fromDate: "2026-10-24",
      toDate: "2026-10-25",
    })
  ).toEqual({
    endDate: new Date("2026-10-25T23:00:00.000Z"),
    startDate: new Date("2026-10-23T22:00:00.000Z"),
  });
});

test("keeps the case-plan per-date reservation maximums for the two offers", () => {
  expect(workspaceE2EMaximumSameDateCoworkReservations["open-space"]).toBe(4);
  expect(workspaceE2EMaximumSameDateCoworkReservations["reserved-desk"]).toBe(
    1
  );
});

test("caps the produced date plan at the case-plan per-date maximums", async () => {
  const allocation = {
    fromOffsetDays: 14,
    shardCount: 1,
    shardIndex: 0,
    toOffsetDays: 39,
  } as const;
  const openSpaceMaximum =
    workspaceE2EMaximumSameDateCoworkReservations["open-space"];
  const openSpaceDates = await Effect.runPromise(
    selectCoworkDates(
      ["2099-08-03", "2099-08-04", "2099-08-05"],
      openSpaceMaximum * 2 + 2,
      { allocation, maximumReservationsPerDate: openSpaceMaximum }
    )
  );

  expect(openSpaceDates).toHaveLength(openSpaceMaximum * 2 + 2);
  expect(
    Math.max(
      ...[...Map.groupBy(openSpaceDates, (date) => date).values()].map(
        ({ length }) => length
      )
    )
  ).toBe(openSpaceMaximum);

  const reservedDeskMaximum =
    workspaceE2EMaximumSameDateCoworkReservations["reserved-desk"];
  const reservedDeskDates = await Effect.runPromise(
    selectCoworkDates(
      ["2099-08-03", "2099-08-04", "2099-08-05"],
      reservedDeskMaximum * 3,
      { allocation, maximumReservationsPerDate: reservedDeskMaximum }
    )
  );

  expect(
    Math.max(
      ...[...Map.groupBy(reservedDeskDates, (date) => date).values()].map(
        ({ length }) => length
      )
    )
  ).toBe(reservedDeskMaximum);
});

test("wires the case-plan per-date maximums through the real case builders", async () => {
  // makeWorkspaceE2ECases composes makeDiscountE2ECases internally, so this
  // single construction proves the limit wiring of both builders: the bulk
  // open-space selection in ./cases/index.ts and the discount open-space plus
  // reserved-desk+monitor selections in ./cases/discounts.ts.
  const openSpaceMaximum =
    workspaceE2EMaximumSameDateCoworkReservations["open-space"];
  const reservedDeskMaximum =
    workspaceE2EMaximumSameDateCoworkReservations["reserved-desk"];
  const openSpaceDates = Array.from(
    { length: 10 },
    (_, index) => `2099-08-${String(index + 1).padStart(2, "0")}`
  );
  const openSpaceDateSet = new Set(openSpaceDates);
  const reservedDeskDates = ["2099-08-24", "2099-08-25"];
  const reservedDeskDateSet = new Set(reservedDeskDates);
  const preparation: WorkspaceE2EPreparation = {
    customerDiscountGroup: {
      basisPoints: 1000,
      id: "e2e-discount-group",
    } as E2EDotyposDiscountGroup,
    discounts: {
      availableBasicDates: openSpaceDates,
      availablePlusDates: [
        "2099-08-20",
        "2099-08-21",
        "2099-08-22",
        "2099-08-23",
      ],
      availableReservedDeskDates: reservedDeskDates,
    },
    meetingRoom: { slots: makeTestMeetingRoomSlots() },
    office: undefined,
  };
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, (() =>
        Promise.reject(
          new Error("provider HTTP must not run in a construction test")
        )) as typeof globalThis.fetch)
    )
  );

  const cases = await Effect.runPromise(
    makeWorkspaceE2ECases({
      allocation: {
        fromOffsetDays: 0,
        shardCount: 1,
        shardIndex: 0,
        toOffsetDays: 0,
      },
      config: makeConstructionTestConfig(),
      datasourceConfig: {} as DatasourceConfig,
      flowStates: [],
      preparation,
      run: makeStubRunner(),
      traceConstruction: false,
    }).pipe(Effect.provide(httpClientLayer))
  );

  expect(cases.length).toBeGreaterThan(0);
  expect(cases.some(({ id }) => id === "checkout-discount-code")).toBe(true);
  const plannedDates = cases.flatMap(({ checkoutStates }) =>
    checkoutStates.map(({ data }) => data.date)
  );
  const maximumPerDate = (pool: ReadonlySet<string>) =>
    Math.max(
      ...[
        ...Map.groupBy(
          plannedDates.filter((date) => pool.has(date)),
          (date) => date
        ).values(),
      ].map(({ length }) => length)
    );
  expect(maximumPerDate(openSpaceDateSet)).toBe(openSpaceMaximum);
  expect(maximumPerDate(reservedDeskDateSet)).toBe(reservedDeskMaximum);
});

test("prepares the transient calendar pool with the bare reserved-desk product", async () => {
  setSystemTime(new Date("2099-07-17T09:48:00.000Z"));
  const allocation = {
    fromOffsetDays: 14,
    shardCount: 1,
    shardIndex: 0,
    toOffsetDays: 45,
  } as const;
  const allocatedWeekdays = Array.from(
    { length: allocation.toOffsetDays - allocation.fromOffsetDays + 1 },
    (_, index) =>
      getWorkspaceE2ECandidateDate(allocation.fromOffsetDays + index)
  ).filter((date) => isWorkspaceE2EAllocatedWeekday(date, allocation));
  // The bulk open-space selection packs 20 dates at 4/date and the calendar
  // sale takes the next 4 at 1/date, so the transient selections land on
  // these later weekdays.
  const bareReservedDeskDates = [
    allocatedWeekdays[9],
    allocatedWeekdays[10],
  ] as const;
  const monitorTaggedDates = [
    allocatedWeekdays[11],
    allocatedWeekdays[12],
  ] as const;
  const requests: URL[] = [];
  const availableDatesFor = (url: URL): readonly string[] => {
    if (url.searchParams.has("monitorOption")) return monitorTaggedDates;
    if (url.searchParams.get("entryTier") === "reserved-desk") {
      return bareReservedDeskDates;
    }
    return allocatedWeekdays;
  };
  const fetchMock: typeof globalThis.fetch = async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const url = new URL(request.url);
    requests.push(url);
    const wantedDates = availableDatesFor(url);
    return Response.json({
      unavailableDates: allocatedWeekdays.filter(
        (date) => !wantedDates.includes(date)
      ),
    });
  };
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
  );
  const config = makeConstructionTestConfig();

  const preparation = await Effect.runPromise(
    prepareDiscountAvailabilityE2E(config, allocation).pipe(
      Effect.provide(httpClientLayer)
    )
  );

  const transientRequest = requests.find(
    (url) => url.searchParams.get("entryTier") === "reserved-desk"
  );
  expect(transientRequest).toBeDefined();
  expect(transientRequest?.searchParams.has("monitorOption")).toBe(false);
  expect(requests.some((url) => url.searchParams.has("monitorOption"))).toBe(
    false
  );
  expect(preparation.availableReservedDeskDates).toEqual([
    ...bareReservedDeskDates,
  ]);

  const cases = await Effect.runPromise(
    makeDiscountE2ECases({
      allocation,
      config,
      datasourceConfig: {} as DatasourceConfig,
      excludedDates: new Set<string>(),
      flowStates: [],
      preparation: {
        ...preparation,
        customerDiscountGroup: {
          basisPoints: 1000,
          id: "e2e-discount-group",
        } as E2EDotyposDiscountGroup,
      },
      run: makeStubRunner(),
    }).pipe(Effect.provide(httpClientLayer))
  );

  const pricingChangeCase = cases.find(
    ({ id }) => id === "calendar-sale-pricing-changes"
  );
  expect(pricingChangeCase).toBeDefined();
  expect(pricingChangeCase?.checkoutStates).toHaveLength(2);
  for (const { data } of pricingChangeCase?.checkoutStates ?? []) {
    const details = data.expectedReservationDetails;
    expect(details).toMatchObject({ entryTier: "reserved-desk" });
    expect(details).not.toHaveProperty("monitorOption");
    expect(new URL(data.checkoutUrl).searchParams.has("monitorOption")).toBe(
      false
    );
    expect(bareReservedDeskDates).toContain(data.date);
    expect(monitorTaggedDates).not.toContain(data.date);
  }
});

test("reports only aggregate capacity for every saleable offer pool", () => {
  const openSpaceMaximum =
    workspaceE2EMaximumSameDateCoworkReservations["open-space"];
  const reservedDeskMaximum =
    workspaceE2EMaximumSameDateCoworkReservations["reserved-desk"];
  const tables: Table[] = [
    makeTable("open-space-table", ["cowork:open-space"], openSpaceMaximum * 8),
    ...Object.entries(workspaceProductMonitorOptionTableTags).map(
      ([monitorOption, tags], index) =>
        makeTable(
          `reserved-desk-${monitorOption}`,
          ["cowork:reserved-desk", ...tags],
          4 + index
        )
    ),
    makeTable("reserved-desk-table", ["cowork:reserved-desk"], 4),
    makeTable("provider-room-id", ["reservation:meeting-room"], 1),
    makeTable("provider-room-2", ["reservation:meeting-room"], 1),
    makeTable("provider-room-3", ["reservation:meeting-room"], 1),
    makeTable("provider-room-headroom", ["reservation:meeting-room"], 1),
    makeTable("provider-office", ["reservation:office"], 8),
    makeTable("hidden-open-space", ["cowork:open-space"], 100, {
      display: false,
    }),
  ];
  const reservations: Reservation[] = [
    makeReservation("open-space-table", 2),
    makeReservation("provider-room-id", 1),
    makeReservation("reserved-desk-table", 1, { status: "CANCELLED" }),
  ];
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations,
    tables,
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(
    report.groups
      .map(({ id }) => id)
      .toSorted((left, right) => left.localeCompare(right))
  ).toEqual(
    [
      "open-space",
      "reserved-desk",
      ...workspaceProductMonitorOptions.map(
        (monitorOption) => `reserved-desk/monitor:${monitorOption}`
      ),
      "reservation:meeting-room",
      "reservation:office",
    ].toSorted((left, right) => left.localeCompare(right))
  );
  expect(report.meetsRequiredCapacity).toBe(true);
  expect(report.supportedConcurrentRuns).toBe(3);
  expect(report.provisionedRunCapacity).toBe(4);
  expect(report.groups.find(({ id }) => id === "open-space")).toEqual({
    activeReservationCount: 1,
    activeReservationSeatCount: 2,
    activeVisibleTableCount: 1,
    assignableTableCount: 1,
    availableSeatCount: openSpaceMaximum * 8 - 2,
    availableTableCount: 0,
    id: "open-space",
    meetsRequiredCapacity: true,
    peakActiveReservationSeatCount: 2,
    peakActiveReservationTableCount: 1,
    requiredAvailableSeatCount: openSpaceMaximum * 2,
    requiredSeatCount: openSpaceMaximum * 4,
    requiredTags: ["cowork:open-space"],
    seatCounts: [openSpaceMaximum * 8],
    totalSeatCount: openSpaceMaximum * 8,
  });
  expect(report.groups.find(({ id }) => id === "reserved-desk")).toMatchObject({
    activeVisibleTableCount: 1,
    assignableTableCount: 1,
    meetsRequiredCapacity: true,
    requiredAvailableSeatCount: reservedDeskMaximum * 2,
    requiredSeatCount: reservedDeskMaximum * 4,
    requiredTags: ["cowork:reserved-desk"],
    totalSeatCount: 4,
  });
  for (const monitorOption of workspaceProductMonitorOptions) {
    expect(
      report.groups.find(
        ({ id }) => id === `reserved-desk/monitor:${monitorOption}`
      )
    ).toMatchObject({
      assignableTableCount: 1,
      meetsRequiredCapacity: true,
      requiredAvailableSeatCount: reservedDeskMaximum * 2,
      requiredTags: [
        "cowork:reserved-desk",
        ...workspaceProductMonitorOptionTableTags[monitorOption],
      ],
    });
  }
  expect(
    report.groups.find(({ id }) => id === "reservation:office")
  ).toMatchObject({
    assignableTableCount: 1,
    meetsRequiredCapacity: true,
    requiredSeatCount: 2,
    requiredTableCount: 1,
    seatCounts: [8],
  });
  const serialized = JSON.stringify(report);
  expect(serialized).not.toContain("open-space-table");
  expect(serialized).not.toContain("reserved-desk-table");
  expect(serialized).not.toContain("provider-room-id");
  expect(serialized).not.toContain("provider-room-2");
  expect(serialized).not.toContain("provider-room-3");
  expect(serialized).not.toContain("provider-room-headroom");
  expect(serialized).not.toContain("provider-office");
});

test("fails closed when tables carry only legacy tier tags", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [],
    tables: [
      makeTable("legacy-basic", ["tier:basic"], 100),
      makeTable("legacy-profi", ["tier:profi"], 100),
    ],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.meetsRequiredCapacity).toBe(false);
  for (const groupId of ["open-space", "reserved-desk"]) {
    expect(report.groups.find(({ id }) => id === groupId)).toMatchObject({
      assignableTableCount: 0,
      meetsRequiredCapacity: false,
    });
  }
});

test("excludes open-space tables carrying stray monitor tags", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [],
    tables: [
      makeTable(
        "open-space-monitor",
        [
          "cowork:open-space",
          ...workspaceProductMonitorOptionTableTags["2x27-qhd"],
        ],
        32
      ),
    ],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.meetsRequiredCapacity).toBe(false);
  expect(report.groups.find(({ id }) => id === "open-space")).toMatchObject({
    assignableTableCount: 0,
    meetsRequiredCapacity: false,
  });
});

test("reserved-desk without addon rejects any monitor tag", () => {
  const partialConfig = workspaceProductMonitorOptionTableTags[
    "2x27-qhd"
  ].slice(0, 1);
  for (const tags of [
    [...partialConfig],
    [...workspaceProductMonitorOptionTableTags["2x27-qhd"]],
    ["monitor:unknown"],
  ]) {
    const report = makeWorkspaceE2ECapacityReport({
      from: new Date("2099-08-01T00:00:00.000Z"),
      reservations: [],
      tables: [
        makeTable("reserved-desk-tagged", ["cowork:reserved-desk", ...tags], 8),
      ],
      to: new Date("2099-09-01T00:00:00.000Z"),
    });

    expect(
      report.groups.find(({ id }) => id === "reserved-desk")
    ).toMatchObject({
      assignableTableCount: 0,
      meetsRequiredCapacity: false,
    });
  }
});

test("configured monitor queries reject partial, unknown, and wrong-size configs", () => {
  const configured = workspaceProductMonitorOptionTableTags["2x27-qhd"];
  const otherConfig = workspaceProductMonitorOptions
    .filter((option) => option !== "2x27-qhd")
    .flatMap((option) => workspaceProductMonitorOptionTableTags[option]);
  for (const tags of [
    [...configured.slice(0, configured.length - 1)],
    [...configured, "monitor:unknown"],
    [...otherConfig],
  ]) {
    const report = makeWorkspaceE2ECapacityReport({
      from: new Date("2099-08-01T00:00:00.000Z"),
      reservations: [],
      tables: [
        makeTable("configured-desk", ["cowork:reserved-desk", ...tags], 8),
      ],
      to: new Date("2099-09-01T00:00:00.000Z"),
    });

    expect(
      report.groups.find(({ id }) => id === "reserved-desk/monitor:2x27-qhd")
    ).toMatchObject({
      assignableTableCount: 0,
      meetsRequiredCapacity: false,
    });
  }
});

test("fails when peak active reservations consume run and cleanup headroom", () => {
  const requiredAvailableSeatCount =
    (1 + 1) * workspaceE2EMaximumSameDateCoworkReservations["open-space"];
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [makeReservation("open-space-table", 10)],
    tables: [
      makeTable(
        "open-space-table",
        ["cowork:open-space"],
        requiredAvailableSeatCount + 9
      ),
    ],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.groups.find(({ id }) => id === "open-space")).toMatchObject({
    availableSeatCount: 7,
    meetsRequiredCapacity: false,
    peakActiveReservationSeatCount: 10,
    requiredAvailableSeatCount,
  });
});

test("does not add reservation usage from non-overlapping dates", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [
      makeReservation("open-space-table", 5),
      makeReservation("open-space-table", 5, {
        endDate: "2099-08-05T18:00:00+00:00",
        startDate: "2099-08-05T08:00:00+00:00",
      }),
    ],
    tables: [makeTable("open-space-table", ["cowork:open-space"], 32)],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.groups.find(({ id }) => id === "open-space")).toMatchObject({
    activeReservationSeatCount: 10,
    availableSeatCount: 27,
    meetsRequiredCapacity: true,
    peakActiveReservationSeatCount: 5,
  });
});

test("fails when overlapping reservations jointly exhaust run and cleanup headroom", () => {
  const requiredAvailableSeatCount =
    (1 + 1) * workspaceE2EMaximumSameDateCoworkReservations["open-space"];
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [
      makeReservation("open-space-table", 8),
      makeReservation("open-space-table", 8, {
        endDate: "2099-08-03T17:00:00+00:00",
        startDate: "2099-08-03T09:00:00+00:00",
      }),
    ],
    tables: [
      makeTable(
        "open-space-table",
        ["cowork:open-space"],
        requiredAvailableSeatCount + 9
      ),
    ],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.groups.find(({ id }) => id === "open-space")).toMatchObject({
    activeReservationSeatCount: 16,
    availableSeatCount: 1,
    meetsRequiredCapacity: false,
    peakActiveReservationSeatCount: 16,
    requiredAvailableSeatCount,
  });
});

test("adds no occupancy for out-of-interval and boundary-touching reservations", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [
      makeReservation("open-space-table", 32, {
        endDate: "2099-07-28T18:00:00+00:00",
        startDate: "2099-07-28T08:00:00+00:00",
      }),
      makeReservation("open-space-table", 32, {
        endDate: "2099-08-01T00:00:00+00:00",
        startDate: "2099-07-31T08:00:00+00:00",
      }),
      makeReservation("open-space-table", 32, {
        endDate: "2099-09-02T08:00:00+00:00",
        startDate: "2099-09-01T00:00:00+00:00",
      }),
    ],
    tables: [makeTable("open-space-table", ["cowork:open-space"], 32)],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.groups.find(({ id }) => id === "open-space")).toMatchObject({
    activeReservationCount: 0,
    activeReservationSeatCount: 0,
    availableSeatCount: 32,
    meetsRequiredCapacity: true,
    peakActiveReservationSeatCount: 0,
  });
});

test("ignores cancelled reservations in capacity accounting", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [
      makeReservation("open-space-table", 32, { status: "CANCELLED" }),
    ],
    tables: [makeTable("open-space-table", ["cowork:open-space"], 32)],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.groups.find(({ id }) => id === "open-space")).toMatchObject({
    activeReservationCount: 0,
    availableSeatCount: 32,
    meetsRequiredCapacity: true,
    peakActiveReservationSeatCount: 0,
  });
});

test("legacy tier pools stay visible without required counts", () => {
  const report = makeWorkspaceE2ELegacyTierCleanupCapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [],
    tables: [
      makeTable("legacy-basic", ["tier:basic"], 16),
      makeTable("legacy-profi", ["tier:profi"], 100),
    ],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(
    workspaceE2ELegacyTierCleanupCapacityGroups.every(
      (group) =>
        group.requiredSeatCount === undefined &&
        group.requiredTableCount === undefined &&
        group.requiredAvailableSeatCount === undefined &&
        group.requiredAvailableTableCount === undefined
    )
  ).toBe(true);
  expect(report.groups.find(({ id }) => id === "tier:basic")).toMatchObject({
    assignableTableCount: 1,
    requiredTags: ["tier:basic"],
    totalSeatCount: 16,
  });
  expect(
    report.groups.find(({ id }) => id === "tier:basic")?.requiredSeatCount
  ).toBeUndefined();
  expect(report.meetsRequiredCapacity).toBe(true);
  expect(getWorkspaceE2ECapacityFailures(report)).toEqual([]);
});

const makeTestMeetingRoomSlots = () =>
  meetingRoomE2EDurations.map((duration, index) => {
    const date = `2099-09-${String(index + 1).padStart(2, "0")}`;
    const startDateTime = `${date}T10:00`;
    const interval = getMeetingRoomReservationInterval(startDateTime, duration);
    if (!interval) throw new Error("meeting-room test interval is invalid");
    return { date, duration, startDateTime, ...interval };
  });

const makeConstructionTestConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: undefined,
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
});

const makeStubRunner = (): Runner => async () => ({
  exitCode: 0,
  stderr: "",
  stdout: "",
});

const makeTable = (
  id: string,
  tags: readonly string[],
  seats: number,
  overrides: Partial<Table> = {}
): Table => ({
  _cloudId: "testing-cloud",
  display: true,
  enabled: true,
  id,
  name: "Aggregate-only test table",
  seats: String(seats),
  tags,
  ...overrides,
});

const makeReservation = (
  tableId: string,
  seats: number,
  overrides: Partial<Reservation> = {}
): Reservation => ({
  _branchId: "testing-branch",
  _cloudId: "testing-cloud",
  _tableId: tableId,
  endDate: "2099-08-03T18:00:00+00:00",
  seats: String(seats),
  startDate: "2099-08-03T08:00:00+00:00",
  status: "CONFIRMED",
  ...overrides,
});
