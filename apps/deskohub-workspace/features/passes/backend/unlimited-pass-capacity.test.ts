import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { expect, spyOn, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationSchema,
  DotyposService,
  type DotyposTable,
  DotyposTableSchema,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { makeRecordingAdvisoryLock } from "@/db/postgres-advisory-lock.test-utils";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation/workspace-table-assignment.service";
import { workspaceProductMonitorOptionTableTags } from "@/features/checkout/product-catalog";
import { orderIdSchema } from "@/features/order";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { GoogleCalendarWorkspaceLimitationsService } from "@/features/reservation/backend/google-calendar-workspace-limitations.service";
import { toReservationRecord } from "@/features/reservation/backend/reservation-record";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import {
  type PendingPassDayCapacity,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { getBookingsWithPassDayIntents } from "./pass-day-capacity-bookings";
import {
  getBookableUnlimitedStartMatrix,
  getBookableUnlimitedStarts,
  withUnlimitedPassCapacity,
} from "./unlimited-pass-capacity";
import {
  createUnlimitedPassDayHold,
  hasUnlimitedPassDayMarker,
  listUnlimitedPassDayHolds,
  matchesUnlimitedPassDayHold,
} from "./unlimited-pass-dotypos-holds";

const startDate = Temporal.PlainDate.from("2099-03-29");
const nextDate = startDate.add({ days: 1 });
const customerId = DotyposCustomerIdSchema.make("1");
const passId = orderIdSchema.make("d4989c37-1c90-4ebc-8cf9-4a6d17612ad6");

const makeTable = (id: string, tags: readonly string[], seats = "1") =>
  Schema.decodeSync(DotyposTableSchema)({
    _cloudId: "1",
    id,
    display: true,
    enabled: true,
    name: `Table ${id}`,
    seats,
    tags: [...tags],
  });

const openTable = makeTable("2", ["cowork:open-space"], "2");
const otherOpenTable = makeTable("3", ["cowork:open-space"]);
const firstDesk = makeTable("4", ["cowork:reserved-desk"]);
const otherDesk = makeTable("5", ["cowork:reserved-desk"]);

const providerBooking = (
  id: string,
  table: DotyposTable,
  date: Temporal.PlainDate
) => {
  const { startsAt, endsAt } = getCoworkReservationInterval(
    "reserved-desk",
    date.toString()
  );
  return Schema.decodeSync(DotyposReservationSchema)({
    _branchId: "1",
    _cloudId: "1",
    _tableId: table.id,
    _customerId: customerId,
    id,
    startDate: startsAt,
    endDate: endsAt,
    seats: table.seats,
    status: "CONFIRMED",
  });
};

const capacityLayer = (input: {
  readonly tables: readonly DotyposTable[];
  readonly providerBookings?: readonly DotyposReservation[];
  readonly intents?: readonly PendingPassDayCapacity[];
  readonly onInventoryRead?: () => void;
}) => {
  const lock = makeRecordingAdvisoryLock();
  const services = Layer.mergeAll(
    Layer.succeed(DotyposService, {
      getTables: () => Effect.succeed(input.tables),
      listActiveReservationsOverlapping: () =>
        Effect.sync(() => {
          input.onInventoryRead?.();
          return input.providerBookings ?? [];
        }),
    } as DotyposService["Service"]),
    Layer.succeed(WorkspaceReservationRepository, {
      selectExpiredHoldDotyposReservationIds: () => Effect.succeed([]),
      selectPendingPassDayCapacity: () => Effect.succeed(input.intents ?? []),
    } as WorkspaceReservationRepository["Service"]),
    Layer.succeed(GoogleCalendarWorkspaceLimitationsService, {
      listLimitations: () => Effect.succeed([]),
    }),
    lock.layer
  );
  return { services, entered: lock.entered };
};

test("loads one calendar inventory and ignores only the named draft's durable claims", async () => {
  let reads = 0;
  const { services } = capacityLayer({
    tables: [firstDesk, openTable],
    intents: [
      {
        passId,
        customerId,
        tableId: firstDesk.id,
        tier: "reserved-desk",
        serviceDate: plainDateStringSchema.make(startDate.toString()),
        holdRequestedAt: null,
        holdAmbiguous: false,
        holdGeneration: null,
        providerReservationId: null,
      },
    ],
    onInventoryRead: () => {
      reads += 1;
    },
  });
  const range = { startsOn: startDate, endsBefore: nextDate };
  const before = await Effect.runPromise(
    getBookableUnlimitedStartMatrix(range).pipe(Effect.provide(services))
  );
  expect(reads).toBe(1);
  expect(before["reserved-desk"]).toEqual([]);
  expect(before["open-space"]).toEqual([startDate]);
  const after = await Effect.runPromise(
    getBookableUnlimitedStartMatrix({
      ...range,
      supersedeOrderId: passId,
    }).pipe(Effect.provide(services))
  );
  expect(reads).toBe(2);
  expect(after["reserved-desk"]).toEqual([startDate]);
});

test("Open Space changes tables by date and keeps the local DST interval", async () => {
  const { services, entered } = capacityLayer({
    tables: [openTable, otherOpenTable],
    providerBookings: [
      providerBooking("10", openTable, startDate),
      providerBooking("11", otherOpenTable, nextDate),
    ],
  });
  const plan = await withUnlimitedPassCapacity(
    { startDate, selection: { tier: "open-space" } },
    Effect.succeed
  ).pipe(Effect.provide(services), Effect.runPromise);

  expect(plan.pinnedDesk).toBeNull();
  expect(plan.days).toHaveLength(30);
  expect(plan.days.slice(0, 2).map(({ tableId }) => tableId)).toEqual([
    otherOpenTable.id,
    openTable.id,
  ]);
  const { startsAt, endsAt } = plan.days[0]!.interval;
  expect(Temporal.Instant.from(endsAt).since(startsAt).total("hours")).toBe(16);
  expect(entered).toEqual(
    plan.days.map(({ serviceDate }) => [
      "reservation-capacity",
      serviceDate.toString(),
    ])
  );
});

test("Reserved Desk excludes a window with free seats every day but no common desk", async () => {
  const { services } = capacityLayer({
    tables: [firstDesk, otherDesk],
    providerBookings: [
      providerBooking("12", firstDesk, startDate),
      providerBooking("13", otherDesk, nextDate),
    ],
  });
  const selection = { tier: "reserved-desk" } as const;
  const bookable = await getBookableUnlimitedStarts({
    selection,
    startsOn: startDate,
    endsBefore: nextDate.add({ days: 1 }),
  }).pipe(Effect.provide(services), Effect.runPromise);
  expect(bookable.map(String)).toEqual([nextDate.toString()]);

  const failure = await withUnlimitedPassCapacity(
    { startDate, selection },
    Effect.succeed
  ).pipe(Effect.flip, Effect.provide(services), Effect.runPromise);
  expect(failure).toMatchObject({
    _tag: "UnlimitedPassCapacityUnavailable",
    reason: "no-common-desk",
  });
});

test.each([
  [
    "keeps the prior Reserved Desk for all 30 renewal days when it is free",
    [],
    otherDesk,
  ],
  [
    "uses one fallback Reserved Desk for all 30 renewal days when the prior desk is busy on the last day",
    [providerBooking("14", otherDesk, startDate.add({ days: 29 }))],
    firstDesk,
  ],
] as const)("%s", async (_name, providerBookings, expectedDesk) => {
  const { services } = capacityLayer({
    tables: [firstDesk, otherDesk],
    providerBookings,
  });
  const plan = await withUnlimitedPassCapacity(
    {
      startDate,
      selection: { tier: "reserved-desk" },
      preferredDeskId: otherDesk.id,
    },
    Effect.succeed
  ).pipe(Effect.provide(services), Effect.runPromise);

  expect(plan.pinnedDesk).toEqual({
    id: expectedDesk.id,
    name: expectedDesk.name,
  });
  expect(
    plan.days.map(({ serviceDate, tableId }) => [String(serviceDate), tableId])
  ).toEqual(
    Array.from({ length: 30 }, (_, index) => [
      String(startDate.add({ days: index })),
      expectedDesk.id,
    ])
  );
});

test("the selected tier determines availability after the Open Space cutoff on a renewal date", async () => {
  const clock = spyOn(Temporal.Now, "instant").mockReturnValue(
    Temporal.Instant.from("2027-03-28T15:00:00Z")
  );
  try {
    const startDate = Temporal.PlainDate.from("2027-03-28");
    const { services } = capacityLayer({ tables: [openTable, firstDesk] });
    const matrix = await getBookableUnlimitedStartMatrix({
      startsOn: startDate,
      endsBefore: startDate.add({ days: 1 }),
    }).pipe(Effect.provide(services), Effect.runPromise);
    expect(matrix["open-space"]).toEqual([]);
    expect(matrix["reserved-desk"].map(String)).toEqual([startDate.toString()]);
  } finally {
    clock.mockRestore();
  }
});

test("the workstation pins an exact monitor setup", async () => {
  const monitorOption = "2x27-qhd";
  const tags = workspaceProductMonitorOptionTableTags[monitorOption];
  const exact = makeTable("6", ["cowork:reserved-desk", ...tags]);
  const contradictory = makeTable("7", [
    "cowork:reserved-desk",
    ...tags,
    "monitor:size:32",
  ]);
  const { services } = capacityLayer({
    tables: [firstDesk, contradictory, exact],
  });
  const plan = await withUnlimitedPassCapacity(
    {
      startDate,
      selection: { tier: "reserved-desk-workstation", monitorOption },
    },
    Effect.succeed
  ).pipe(Effect.provide(services), Effect.runPromise);
  expect(plan.pinnedDesk).toEqual({ id: exact.id, name: exact.name });
  expect(plan.days.every(({ tableId }) => tableId === exact.id)).toBe(true);
  const { startsAt, endsAt } = plan.days[0]!.interval;
  expect(Temporal.Instant.from(endsAt).since(startsAt).total("hours")).toBe(23);
});

test("ordinary assignment counts a durable intent and deduplicates its visible provider hold", async () => {
  const serviceDate = plainDateStringSchema.make(startDate.toString());
  const generation = crypto.randomUUID();
  const intent = {
    tableId: openTable.id,
    serviceDate,
    passId,
    customerId,
    tier: "open-space",
    holdRequestedAt: Temporal.Instant.from("2099-03-01T12:00:00Z"),
    holdAmbiguous: false,
    holdGeneration: generation,
    providerReservationId: null,
  } as const;
  const interval = getCoworkReservationInterval("open-space", serviceDate);
  const day = { tableId: openTable.id, serviceDate: startDate, interval };
  const record = await createUnlimitedPassDayHold({
    passId,
    customerId,
    day,
    generation,
  }).pipe(
    Effect.provideService(DotyposService, {
      createReservation: ({ note }) =>
        Effect.succeed({
          ...providerBooking("15", openTable, startDate),
          startDate: interval.startsAt,
          endDate: interval.endsAt,
          seats: "1",
          status: "NEW",
          note,
        }),
    } as DotyposService["Service"]),
    Effect.runPromise
  );
  expect(hasUnlimitedPassDayMarker(record, passId, startDate, generation)).toBe(
    true
  );
  expect(
    matchesUnlimitedPassDayHold(record, { passId, customerId, day, generation })
  ).toBe(true);
  const previous = {
    ...record,
    id: providerBooking("16", openTable, startDate).id,
    note: record.note?.replace(generation, crypto.randomUUID()),
  };
  expect(
    getBookingsWithPassDayIntents([previous, record], [intent], passId)
  ).toHaveLength(2);
  const copied = { ...record, id: previous.id };
  const repeated = getBookingsWithPassDayIntents([record, record], [intent]);
  expect(repeated).toHaveLength(1);
  const movedRecord = { ...record, _tableId: otherOpenTable.id };
  expect(
    getBookingsWithPassDayIntents([movedRecord, record], [intent]).map(
      ({ tableId }) => tableId
    )
  ).toEqual([otherOpenTable.id, openTable.id]);
  expect(
    getBookingsWithPassDayIntents([record, copied], [intent], passId)
  ).toHaveLength(3);
  expect(
    getBookingsWithPassDayIntents(
      [record, copied],
      [{ ...intent, providerReservationId: record.id }],
      passId
    )
  ).toHaveLength(1);
  expect(
    getBookingsWithPassDayIntents(
      [copied],
      [{ ...intent, holdAmbiguous: true }],
      passId
    )
  ).toHaveLength(2);
  expect(
    getBookingsWithPassDayIntents(
      [record],
      [{ ...intent, holdRequestedAt: null }]
    )
  ).toHaveLength(2);

  const assigned = ({
    tables,
    providerBookings,
  }: {
    tables: readonly DotyposTable[];
    providerBookings?: readonly DotyposReservation[];
  }) => {
    const { services } = capacityLayer({
      tables,
      providerBookings,
      intents: [intent],
    });
    return Effect.flatMap(WorkspaceTableAssignmentService, (service) =>
      service.assignTableId({
        kind: "cowork",
        entryTier: "open-space",
        date: serviceDate,
        coffee: false,
      })
    ).pipe(
      Effect.provide(
        WorkspaceTableAssignmentService.Default.pipe(Layer.provide(services))
      ),
      Effect.runPromise
    );
  };

  await expect(
    assigned({ tables: [{ ...openTable, seats: "1" }] })
  ).rejects.toMatchObject({ _tag: "TableAssignmentUnavailableError" });
  await expect(
    assigned({ tables: [openTable], providerBookings: [record] })
  ).resolves.toBe(openTable.id);
  await expect(
    assigned({ tables: [openTable], providerBookings: [record, record] })
  ).resolves.toBe(openTable.id);
  await expect(
    assigned({ tables: [openTable], providerBookings: [previous] })
  ).rejects.toMatchObject({ _tag: "TableAssignmentUnavailableError" });

  // The shared snapshot contains the same occupancy without private fields.
  // The calendar must still keep the second seat bookable during handover.
  const advisory = Layer.succeed(AdvisoryAvailabilityInventory, {
    tables: Effect.succeed([openTable]),
    listLimitations: () => Effect.succeed([]),
    listActiveReservationsOverlapping: () =>
      Effect.succeed([toReservationRecord(record)]),
  });
  const cached = toReservationRecord(record);
  expect(cached.unlimitedPassDay).toBe(true);
  expect(cached).not.toHaveProperty("note");
  const { services } = capacityLayer({
    tables: [openTable],
    providerBookings: [record],
    intents: [intent],
  });
  const availability = await Effect.flatMap(
    WorkspaceAvailabilityService,
    (service) =>
      service.getAvailability({
        query: {
          kind: "cowork",
          entryTier: "open-space",
          from: serviceDate,
          to: serviceDate,
          date: serviceDate,
        },
      })
  ).pipe(
    Effect.provide(
      WorkspaceAvailabilityService.Default.pipe(
        Layer.provide(Layer.mergeAll(services, advisory))
      )
    ),
    Effect.runPromise
  );
  expect(availability.unavailableDates).toEqual([]);

  const cancelled = { ...record, status: "CANCELLED" } as const;
  const other = { ...record, note: `${record.note} altered` };
  const listed = await listUnlimitedPassDayHolds({
    passId,
    customerId,
    startDate,
  }).pipe(
    Effect.provideService(DotyposService, {
      listReservations: () =>
        Effect.succeed([record, cancelled, { ...other, note: "unrelated" }]),
    } as DotyposService["Service"]),
    Effect.runPromise
  );
  expect(listed).toEqual([record, cancelled]);
});
