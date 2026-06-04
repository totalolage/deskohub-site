import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Context, Data, Effect, Layer } from "effect";
import { getAssignableDotyposTableId } from "@/features/checkout/backend/dotypos-table-id";
import { ReservationHoldCleanupService } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import {
  getWorkspaceProductByTier,
  isWorkspaceProductMonitorOption,
  isWorkspaceProductTier,
  type WorkspaceProductMonitorOption,
  type WorkspaceProductTier,
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
  workspaceProductTiers,
} from "@/features/checkout/product-catalog";

export type WorkspaceAvailabilityQuery = {
  readonly date?: string;
  readonly from: string;
  readonly to: string;
  readonly entryTier?: WorkspaceProductTier;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

export type WorkspaceAvailability = {
  readonly date?: string;
  readonly from: string;
  readonly to: string;
  readonly unavailableDates: readonly string[];
  readonly unavailableTiers: readonly WorkspaceProductTier[];
  readonly unavailableMonitorOptions: readonly WorkspaceProductMonitorOption[];
};

export class WorkspaceTableUnavailableError extends Data.TaggedError(
  "WorkspaceTableUnavailableError"
)<{
  readonly date: string;
  readonly tier: WorkspaceProductTier;
  readonly monitorOption?: WorkspaceProductMonitorOption;
}> {}

export interface WorkspaceAvailabilityService {
  readonly getAvailability: (
    query: WorkspaceAvailabilityQuery
  ) => Effect.Effect<
    WorkspaceAvailability,
    ExternalAPIError | NetworkError | ValidationError
  >;
  readonly ensureAvailable: (query: {
    readonly date: string;
    readonly entryTier: WorkspaceProductTier;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  }) => Effect.Effect<
    void,
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | WorkspaceTableUnavailableError
  >;
}

export const WorkspaceAvailabilityService =
  Context.GenericTag<WorkspaceAvailabilityService>(
    "WorkspaceAvailabilityService"
  );

export const WorkspaceAvailabilityServiceLive = Layer.effect(
  WorkspaceAvailabilityService,
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const holdCleanup = yield* ReservationHoldCleanupService;

    const loadInventory = Effect.fn("workspaceAvailability.loadInventory")(
      function* () {
        yield* Effect.logInfo("Workspace availability inventory load started");

        const sweepResult = yield* holdCleanup
          .sweepExpiredHolds({ now: new Date(), limit: 10 })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logWarning("Availability expired hold sweep failed", {
                cause,
              })
            ),
            Effect.either
          );
        yield* Effect.annotateLogsScoped({ sweepResult });
        yield* Effect.logInfo(
          "Workspace availability expired hold sweep completed"
        );

        const [tables, reservations] = yield* Effect.all(
          [dotypos.getTables(), dotypos.listReservations()],
          { concurrency: 2 }
        );
        yield* Effect.annotateLogsScoped({ tables, reservations });
        yield* Effect.logInfo(
          "Workspace availability inventory load completed"
        );

        return { tables, reservations };
      },
      (effect) =>
        effect.pipe(
          Effect.scoped,
          Effect.tapError((cause) =>
            Effect.logError("Workspace availability inventory load failed", {
              cause,
            })
          )
        )
    );

    const getAvailability = Effect.fn("workspaceAvailability.getAvailability")(
      function* (query: WorkspaceAvailabilityQuery) {
        yield* Effect.annotateLogsScoped({ query });
        yield* Effect.logInfo("Workspace availability computation started");

        const dates = yield* getDateRange(query.from, query.to);
        const date = query.date ? yield* parsePlainDate(query.date) : undefined;
        yield* Effect.annotateLogsScoped({ dates, date });

        const { tables, reservations } = yield* loadInventory();
        const occupiedTableIdsByDate = new Map<string, Set<string>>();

        for (const day of dates) {
          occupiedTableIdsByDate.set(
            plainDateToString(day),
            getOccupiedTableIds(reservations, day)
          );
        }

        const unavailableDates = dates
          .filter((day) =>
            isUnavailableForSelection(
              tables,
              occupiedTableIdsByDate.get(plainDateToString(day)) ?? new Set(),
              query.entryTier,
              query.monitorOption
            )
          )
          .map(plainDateToString);

        const selectedDateOccupiedIds = date
          ? getOccupiedTableIds(reservations, date)
          : new Set<string>();

        const result = {
          date: query.date,
          from: query.from,
          to: query.to,
          unavailableDates,
          unavailableTiers: date
            ? workspaceProductTiers.filter((tier) =>
                isTierUnavailable(tables, selectedDateOccupiedIds, tier)
              )
            : [],
          unavailableMonitorOptions: date
            ? workspaceProductMonitorOptions.filter((option) =>
                isMonitorOptionUnavailable(
                  tables,
                  selectedDateOccupiedIds,
                  option
                )
              )
            : [],
        } satisfies WorkspaceAvailability;

        yield* Effect.annotateLogsScoped({ result });
        yield* Effect.logInfo("Workspace availability computed");

        return result;
      },
      (effect, query) =>
        effect.pipe(
          Effect.scoped,
          Effect.tapError((cause) =>
            Effect.logError("Workspace availability computation failed", {
              cause,
            })
          ),
          Effect.annotateLogs({
            date: query.date,
            from: query.from,
            to: query.to,
            entryTier: query.entryTier,
            monitorOption: query.monitorOption,
          })
        )
    );

    const ensureAvailable = Effect.fn("workspaceAvailability.ensureAvailable")(
      function* (query: {
        readonly date: string;
        readonly entryTier: WorkspaceProductTier;
        readonly monitorOption?: WorkspaceProductMonitorOption;
      }) {
        yield* Effect.annotateLogsScoped({ query });
        yield* Effect.logInfo("Workspace availability assurance started");

        const availability = yield* getAvailability({
          date: query.date,
          from: query.date,
          to: query.date,
          entryTier: query.entryTier,
          monitorOption: query.monitorOption,
        });
        yield* Effect.annotateLogsScoped({ availability });

        if (!availability.unavailableDates.includes(query.date)) {
          yield* Effect.logDebug("Workspace availability assurance passed");
          return;
        }

        yield* Effect.logWarning("Workspace availability assurance failed");

        return yield* new WorkspaceTableUnavailableError({
          date: query.date,
          tier: query.entryTier,
          monitorOption: query.monitorOption,
        });
      },
      (effect) => effect.pipe(Effect.scoped)
    );

    return WorkspaceAvailabilityService.of({
      getAvailability,
      ensureAvailable,
    });
  })
);

const isUnavailableForSelection = (
  tables: readonly Table[],
  occupiedTableIds: ReadonlySet<string>,
  tier?: WorkspaceProductTier,
  monitorOption?: WorkspaceProductMonitorOption
) => {
  if (!tier) {
    return workspaceProductTiers.every((candidateTier) =>
      isTierUnavailable(tables, occupiedTableIds, candidateTier)
    );
  }

  const product = getWorkspaceProductByTier(tier);
  if (!product.requiresMonitorOption) {
    return isTierUnavailable(tables, occupiedTableIds, tier);
  }

  if (monitorOption) {
    return isMonitorOptionUnavailable(tables, occupiedTableIds, monitorOption);
  }

  return product.allowedMonitorOptions.every((option) =>
    isMonitorOptionUnavailable(tables, occupiedTableIds, option)
  );
};

const isTierUnavailable = (
  tables: readonly Table[],
  occupiedTableIds: ReadonlySet<string>,
  tier: WorkspaceProductTier
) => {
  const product = getWorkspaceProductByTier(tier);

  if (product.requiresMonitorOption) {
    return product.allowedMonitorOptions.every((option) =>
      isMonitorOptionUnavailable(tables, occupiedTableIds, option)
    );
  }

  return !hasAvailableTable(tables, occupiedTableIds, [`tier:${tier}`]);
};

const isMonitorOptionUnavailable = (
  tables: readonly Table[],
  occupiedTableIds: ReadonlySet<string>,
  monitorOption: WorkspaceProductMonitorOption
) =>
  !hasAvailableTable(tables, occupiedTableIds, [
    "tier:profi",
    ...workspaceProductMonitorOptionTableTags[monitorOption],
  ]);

const hasAvailableTable = (
  tables: readonly Table[],
  occupiedTableIds: ReadonlySet<string>,
  requiredTags: readonly string[]
) =>
  tables.some((table) => {
    const tableId = getAssignableTableId(table, requiredTags);
    return Boolean(tableId && !occupiedTableIds.has(tableId));
  });

const getAssignableTableId = (
  table: Table,
  requiredTags: readonly string[]
) => {
  const tableId = getAssignableDotyposTableId(table);
  if (!tableId) return undefined;
  if (table.enabled !== true || table.display !== true) return undefined;

  const tableTags = new Set(table.tags ?? []);
  if (!requiredTags.every((tag) => tableTags.has(tag))) return undefined;

  return tableId;
};

const getOccupiedTableIds = (
  reservations: readonly Reservation[],
  day: Temporal.PlainDate
) => {
  const occupied = new Set<string>();
  const dayRange = getPragueDayRange(day);

  for (const reservation of reservations) {
    if (reservation.status === "CANCELLED") continue;
    if (reservation.status !== "NEW" && reservation.status !== "CONFIRMED") {
      continue;
    }
    if (!reservation._tableId) continue;

    const reservationStart = Date.parse(reservation.startDate);
    const reservationEnd = Date.parse(reservation.endDate);
    if (
      !Number.isFinite(reservationStart) ||
      !Number.isFinite(reservationEnd)
    ) {
      continue;
    }

    if (
      reservationStart < dayRange.endMs &&
      reservationEnd > dayRange.startMs
    ) {
      occupied.add(reservation._tableId);
    }
  }

  return occupied;
};

const getPragueDayRange = (date: Temporal.PlainDate) => {
  const startMs = date
    .toZonedDateTime({ timeZone: "Europe/Prague" })
    .toInstant().epochMilliseconds;
  const endMs = date
    .add({ days: 1 })
    .toZonedDateTime({ timeZone: "Europe/Prague" })
    .toInstant().epochMilliseconds;

  return { startMs, endMs };
};

const getDateRange = (from: string, to: string) =>
  Effect.gen(function* () {
    const start = yield* parsePlainDate(from);
    const end = yield* parsePlainDate(to);

    if (Temporal.PlainDate.compare(start, end) > 0) {
      return yield* new ValidationError({
        message: "Availability range start must be before range end",
      });
    }

    const dates: Temporal.PlainDate[] = [];
    for (
      let cursor = start;
      Temporal.PlainDate.compare(cursor, end) <= 0;
      cursor = cursor.add({ days: 1 })
    ) {
      dates.push(cursor);
    }

    return dates;
  });

const parsePlainDate = (date: string) =>
  Effect.try({
    try: () => Temporal.PlainDate.from(date),
    catch: () =>
      new ValidationError({
        message: `Availability date must be a valid YYYY-MM-DD date: ${date}`,
      }),
  });

const plainDateToString = (date: Temporal.PlainDate) => date.toString();

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const pragueDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const getCurrentPragueDate = (date: Date) => {
  const dateParts = Object.fromEntries(
    pragueDateFormatter
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
};

const getDateParam = (searchParams: URLSearchParams, key: string) => {
  const value = searchParams.get(key)?.trim();
  if (!value || !datePattern.test(value)) return undefined;
  return value;
};

export const parseWorkspaceAvailabilityQuery = (
  searchParams: URLSearchParams,
  now = new Date()
): WorkspaceAvailabilityQuery => {
  const today = getCurrentPragueDate(now);
  const from = getDateParam(searchParams, "from") ?? today;
  const to =
    getDateParam(searchParams, "to") ??
    Temporal.PlainDate.from(today).add({ months: 6 }).toString();
  const date = getDateParam(searchParams, "date");
  const entryTier = getTierParam(searchParams.get("entryTier"));
  const monitorOption = getMonitorParam(searchParams.get("monitorOption"));

  return {
    from,
    to,
    ...(date && { date }),
    ...(entryTier && { entryTier }),
    ...(monitorOption && { monitorOption }),
  };
};

const getTierParam = (value: string | null) => {
  const normalized = value?.trim();
  return isWorkspaceProductTier(normalized) ? normalized : undefined;
};

const getMonitorParam = (value: string | null) => {
  const normalized = value?.trim();
  return isWorkspaceProductMonitorOption(normalized) ? normalized : undefined;
};
