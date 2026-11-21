import type { DotyposTableId } from "@deskohub/dotypos";
import { Data, Effect } from "effect";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import {
  decodeTableCandidates,
  excludeDotyposReservationsById,
  getOccupancyWindow,
  getTableBookingOccupancyById,
  getWorkspaceTableCandidatesByPredicate,
  hasCandidateCapacity,
  isWorkspaceCoworkTableCandidate,
  type WorkspaceCoworkTableCandidateQuery,
  type WorkspaceTableCandidate,
} from "@/features/checkout/backend/reservation";
import { selectWorkspaceTableFromCandidates } from "@/features/checkout/backend/reservation/workspace-table-selection";
import {
  type WorkspaceProductMonitorOption,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import type { OrderId } from "@/features/order";
import {
  getFullyOccupiedCalendarDates,
  makeProviderInventory,
} from "@/features/reservation/backend/availability-inventory";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  getCoworkReservationInterval,
  isCoworkOpenSpaceDayCutoffReached,
} from "@/features/reservation/cowork-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import type { ReservationInterval } from "@/features/reservation/reservation-interval";
import { getPlainDatesBetween } from "@/shared/utils/temporal";
import { unlimitedPassDays } from "../pass-offer";
import {
  getBookingsWithPassDayIntents,
  observePassDayInventory,
} from "./pass-day-capacity-bookings";

export type UnlimitedPassCapacitySelection =
  | { readonly tier: "open-space" | "reserved-desk" }
  | {
      readonly tier: "reserved-desk-workstation";
      readonly monitorOption: WorkspaceProductMonitorOption;
    };

export type UnlimitedPassDay = {
  readonly serviceDate: Temporal.PlainDate;
  readonly tableId: DotyposTableId;
  readonly interval: ReservationInterval;
};

export type UnlimitedPassCapacityPlan = {
  readonly days: readonly UnlimitedPassDay[];
  readonly pinnedDesk: Pick<
    WorkspaceTableCandidate["table"],
    "id" | "name"
  > | null;
};

class UnlimitedPassCapacityUnavailable extends Data.TaggedError(
  "UnlimitedPassCapacityUnavailable"
)<{
  readonly blockingDates: readonly Temporal.PlainDate[];
  readonly reason: "day-unavailable" | "no-common-desk";
}> {}

class InvalidUnlimitedStartRange extends Data.TaggedError(
  "InvalidUnlimitedStartRange"
)<{
  readonly message: string;
}> {}

export const unlimitedStartRangeMaxDays = 62;

const getCapacityQuery = (
  selection: UnlimitedPassCapacitySelection
): WorkspaceCoworkTableCandidateQuery =>
  selection.tier === "reserved-desk-workstation"
    ? { entryTier: "reserved-desk", monitorOption: selection.monitorOption }
    : { entryTier: selection.tier };

const loadUnlimitedInventory = Effect.fn("loadUnlimitedInventory")(function* (
  dates: readonly Temporal.PlainDate[],
  now: Temporal.Instant,
  supersedeOrderId?: OrderId
) {
  const inventory = yield* makeProviderInventory;
  const workspaceReservations = yield* WorkspaceReservationRepository;
  const first = dates[0]!;
  const last = dates.at(-1)!;
  // Read intents before the provider list so a concurrent attach cannot
  // disappear between a stale provider list and a later local-state read.
  const intents = yield* workspaceReservations.selectPendingPassDayCapacity({
    first,
    last,
  });

  const reads = yield* Effect.all(
    {
      tables: inventory.tables,
      observations: observePassDayInventory(
        workspaceReservations,
        inventory.listActiveReservationsOverlapping({
          startDate: new Date(
            getOccupancyWindow(
              getCoworkReservationInterval("reserved-desk", first.toString())
            ).startsAt
          ),
          endDate: new Date(
            getOccupancyWindow(
              getCoworkReservationInterval("reserved-desk", last.toString())
            ).endsAt
          ),
        }),
        intents
      ),
      limitations: inventory.listLimitations({
        from: first.toString(),
        to: last.toString(),
      }),
      expiredIds: workspaceReservations.selectExpiredHoldDotyposReservationIds({
        now,
      }),
    },
    { concurrency: "unbounded", mode: "result" }
  );
  const observations = yield* Effect.fromResult(reads.observations);
  const expiredIds = yield* Effect.fromResult(reads.expiredIds);

  return {
    tables: yield* Effect.fromResult(reads.tables),
    closedDates: getFullyOccupiedCalendarDates(
      yield* Effect.fromResult(reads.limitations)
    ),
    bookings: getBookingsWithPassDayIntents(
      excludeDotyposReservationsById(observations.reservations, expiredIds),
      observations.passDayIntents,
      supersedeOrderId
    ),
  };
});

const evaluateUnlimitedCapacity = Effect.fn("evaluateUnlimitedCapacity")(
  function* (
    selection: UnlimitedPassCapacitySelection,
    dates: readonly Temporal.PlainDate[],
    now: Temporal.Instant,
    {
      tables,
      closedDates,
      bookings,
    }: Effect.Success<ReturnType<typeof loadUnlimitedInventory>>
  ) {
    const query = getCapacityQuery(selection);

    const candidates = yield* Effect.fromResult(
      decodeTableCandidates(
        getWorkspaceTableCandidatesByPredicate(tables, (tags) =>
          isWorkspaceCoworkTableCandidate(tags, query)
        )
      )
    );
    const today = getCurrentWorkspaceDate(now);
    const days = dates.map((serviceDate) => {
      const interval = getCoworkReservationInterval(
        query.entryTier,
        serviceDate.toString()
      );
      const occupancy = getTableBookingOccupancyById(
        bookings,
        getOccupancyWindow(interval)
      );
      const date = serviceDate.toString();
      const closed =
        Temporal.PlainDate.compare(serviceDate, today) < 0 ||
        closedDates.has(date) ||
        isCoworkOpenSpaceDayCutoffReached({
          entryTier: query.entryTier,
          date,
          now,
        });
      const freeTables = closed
        ? []
        : candidates
            .filter((candidate) => hasCandidateCapacity([candidate], occupancy))
            .map(({ table }) => table);

      return { serviceDate, interval, occupancy, freeTables };
    });

    return { tables, days };
  }
);

type CapacityInventory = Effect.Success<
  ReturnType<typeof evaluateUnlimitedCapacity>
>;
type CapacityDay = CapacityInventory["days"][number];

const getCommonDesks = (days: readonly CapacityDay[]) =>
  days[0]!.freeTables.filter(({ id }) =>
    days.every(({ freeTables }) => freeTables.some((table) => table.id === id))
  );

type UnlimitedStartRange = {
  readonly startsOn: Temporal.PlainDate;
  readonly endsBefore: Temporal.PlainDate;
  readonly supersedeOrderId?: OrderId;
};

const getStartRangeDates = Effect.fnUntraced(function* (
  input: UnlimitedStartRange
) {
  const dayCount = input.startsOn.until(input.endsBefore).days;
  if (dayCount < 0 || dayCount > unlimitedStartRangeMaxDays) {
    return yield* new InvalidUnlimitedStartRange({
      message: `Unlimited start range must cover at most ${unlimitedStartRangeMaxDays} days in chronological order.`,
    });
  }
  const dates =
    dayCount === 0
      ? []
      : getPlainDatesBetween(
          input.startsOn,
          input.endsBefore.add({ days: unlimitedPassDays - 2 })
        );
  return { dayCount, dates };
});

const filterBookableStarts = (
  selection: UnlimitedPassCapacitySelection,
  dates: readonly Temporal.PlainDate[],
  dayCount: number,
  days: readonly CapacityDay[]
) =>
  dates.slice(0, dayCount).filter((_, index) => {
    const window = days.slice(index, index + unlimitedPassDays);
    return selection.tier === "open-space"
      ? window.every(({ freeTables }) => freeTables.length > 0)
      : getCommonDesks(window).length > 0;
  });

/** Loads a calendar-sized range of possible starts with one inventory read. */
export const getBookableUnlimitedStarts = Effect.fn(
  "getBookableUnlimitedStarts"
)(function* (
  input: UnlimitedStartRange & {
    readonly selection: UnlimitedPassCapacitySelection;
  }
) {
  const { dayCount, dates } = yield* getStartRangeDates(input);
  if (!dayCount) return [];
  const now = Temporal.Now.instant();
  const inventory = yield* loadUnlimitedInventory(
    dates,
    now,
    input.supersedeOrderId
  );
  const { days } = yield* evaluateUnlimitedCapacity(
    input.selection,
    dates,
    now,
    inventory
  );
  return filterBookableStarts(input.selection, dates, dayCount, days);
});

/** All offers on a visible calendar share the same provider inventory read. */
export const getBookableUnlimitedStartMatrix = Effect.fn(
  "getBookableUnlimitedStartMatrix"
)(function* (input: UnlimitedStartRange) {
  const { dates, dayCount } = yield* getStartRangeDates(input);
  const now = Temporal.Now.instant();
  const inventory = dayCount
    ? yield* loadUnlimitedInventory(dates, now, input.supersedeOrderId)
    : undefined;
  const read = (selection: UnlimitedPassCapacitySelection) =>
    inventory
      ? evaluateUnlimitedCapacity(selection, dates, now, inventory).pipe(
          Effect.map(({ days }) =>
            filterBookableStarts(selection, dates, dayCount, days)
          )
        )
      : Effect.succeed([]);
  const workstation = (monitorOption: WorkspaceProductMonitorOption) =>
    read({ tier: "reserved-desk-workstation", monitorOption });
  const [first, second, third, fourth] = workspaceProductMonitorOptions;
  return yield* Effect.all({
    "open-space": read({ tier: "open-space" }),
    "reserved-desk": read({ tier: "reserved-desk" }),
    "reserved-desk-workstation": Effect.all({
      [first]: workstation(first),
      [second]: workstation(second),
      [third]: workstation(third),
      [fourth]: workstation(fourth),
    }),
  });
});

const getPassDates = (startDate: Temporal.PlainDate) =>
  getPlainDatesBetween(
    startDate,
    startDate.add({ days: unlimitedPassDays - 1 })
  );

const allocateUnlimitedPass = Effect.fn("allocateUnlimitedPass")(function* (
  selection: UnlimitedPassCapacitySelection,
  dates: readonly Temporal.PlainDate[],
  preferredDeskId?: DotyposTableId
) {
  const now = Temporal.Now.instant();
  const inventory = yield* loadUnlimitedInventory(dates, now);
  const { tables, days } = yield* evaluateUnlimitedCapacity(
    selection,
    dates,
    now,
    inventory
  );
  const blocked = days.filter(({ freeTables }) => freeTables.length === 0);
  if (blocked.length > 0) {
    return yield* new UnlimitedPassCapacityUnavailable({
      blockingDates: blocked.map(({ serviceDate }) => serviceDate),
      reason: "day-unavailable",
    });
  }

  if (selection.tier === "open-space") {
    const planDays = yield* Effect.forEach(
      days,
      Effect.fnUntraced(function* ({
        serviceDate,
        interval,
        freeTables,
        occupancy,
      }) {
        const table = yield* selectWorkspaceTableFromCandidates(
          freeTables,
          tables,
          occupancy
        );
        // Capacity was checked above, using the same seats and occupancy.
        return { serviceDate, interval, tableId: table!.id };
      })
    );
    return {
      days: planDays,
      pinnedDesk: null,
    } satisfies UnlimitedPassCapacityPlan;
  }

  const commonDesks = getCommonDesks(days);
  if (commonDesks.length === 0) {
    return yield* new UnlimitedPassCapacityUnavailable({
      blockingDates: dates,
      reason: "no-common-desk",
    });
  }

  const preferredDesk = commonDesks.find(({ id }) => id === preferredDeskId);
  // Fall back to the day-booking ranking when the previous desk cannot cover the period.
  const desk =
    preferredDesk ??
    (yield* selectWorkspaceTableFromCandidates(
      commonDesks,
      tables,
      days[0]!.occupancy
    ))!;
  return {
    pinnedDesk: { id: desk.id, name: desk.name },
    days: days.map(({ serviceDate, interval }) => ({
      serviceDate,
      interval,
      tableId: desk.id,
    })),
  } satisfies UnlimitedPassCapacityPlan;
});

/** The callback commits the plan's durable day intents before releasing the locks. */
export const withUnlimitedPassCapacity = <A, E, R>(
  input: {
    readonly selection: UnlimitedPassCapacitySelection;
    readonly startDate: Temporal.PlainDate;
    readonly preferredDeskId?: DotyposTableId;
  },
  save: (plan: UnlimitedPassCapacityPlan) => Effect.Effect<A, E, R>
) => {
  const dates = getPassDates(input.startDate);
  return allocateUnlimitedPass(
    input.selection,
    dates,
    input.preferredDeskId
  ).pipe(
    Effect.flatMap(save),
    WorkspaceLockSections.reservationCapacity(dates)
  );
};
