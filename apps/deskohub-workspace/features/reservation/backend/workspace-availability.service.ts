import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import type { GoogleCalendarError } from "@deskohub/google-calendar";
import { Context, Data, Effect, Layer, Match } from "effect";
import { cacheLife, revalidateTag } from "next/cache";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import {
  getWorkspaceTableOccupancyById,
  workspaceBookingGuestCount,
} from "@/features/checkout/backend/workspace-table-occupancy";
import { hasAvailableWorkspaceTableCandidate } from "@/features/checkout/backend/workspace-table-selection";
import {
  getWorkspaceProductByTier,
  type WorkspaceProductMonitorOption,
  type WorkspaceProductTier,
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
  workspaceProductTiers,
} from "@/features/checkout/product-catalog";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { GoogleCalendarServiceLive } from "@/shared/backend/config/google-calendar.config";
import { runWorkspaceEffectWithLogAnnotations } from "@/shared/backend/logging/censorship";
import {
  applyCacheTags,
  workspaceAvailabilityTags,
} from "@/shared/utils/cache-tags";
import type {
  WorkspaceAvailability,
  WorkspaceAvailabilityNotice,
  WorkspaceAvailabilityQuery,
} from "../schemas/workspace-availability";
import {
  GoogleCalendarWorkspaceLimitationsService,
  type IGoogleCalendarWorkspaceLimitationsService,
  type WorkspaceCalendarLimitation as WorkspaceCalendarLimitationType,
} from "./google-calendar-workspace-limitations.service";

type WorkspaceAvailabilityError =
  | ExternalAPIError
  | GoogleCalendarError
  | NetworkError
  | ValidationError
  | WorkspaceAvailabilityInventoryCacheError;

type WorkspaceAvailabilityInventory = {
  readonly tables: readonly Table[];
  readonly reservations: readonly Reservation[];
  readonly limitations: readonly WorkspaceCalendarLimitationType[];
};

type WorkspaceAvailabilityDotyposInventoryService = {
  readonly getTables: () => Effect.Effect<
    readonly Table[],
    ExternalAPIError | NetworkError | ValidationError
  >;
  readonly listReservations: () => Effect.Effect<
    readonly Reservation[],
    ExternalAPIError | NetworkError | ValidationError
  >;
};

export class WorkspaceTableUnavailableError extends Data.TaggedError(
  "WorkspaceTableUnavailableError"
)<{
  readonly date: string;
  readonly tier: WorkspaceProductTier;
  readonly monitorOption?: WorkspaceProductMonitorOption;
}> {}

class WorkspaceAvailabilityInventoryCacheError extends Data.TaggedError(
  "WorkspaceAvailabilityInventoryCacheError"
)<{
  readonly cause: unknown;
}> {}

export interface IWorkspaceAvailabilityInventoryService {
  readonly loadFresh: (
    query: Pick<WorkspaceAvailabilityQuery, "from" | "to">
  ) => Effect.Effect<
    WorkspaceAvailabilityInventory,
    WorkspaceAvailabilityError
  >;
  readonly loadAdvisory: (
    query: Pick<WorkspaceAvailabilityQuery, "from" | "to">
  ) => Effect.Effect<
    WorkspaceAvailabilityInventory,
    WorkspaceAvailabilityError
  >;
  readonly invalidateAdvisory: () => Effect.Effect<
    void,
    WorkspaceAvailabilityError
  >;
}

export class WorkspaceAvailabilityInventoryService extends Context.Service<
  WorkspaceAvailabilityInventoryService,
  IWorkspaceAvailabilityInventoryService
>()("WorkspaceAvailabilityInventoryService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const calendarLimitations =
        yield* GoogleCalendarWorkspaceLimitationsService;

      const loadFresh = (
        query: Pick<WorkspaceAvailabilityQuery, "from" | "to">
      ) =>
        loadFreshWorkspaceAvailabilityInventory({
          calendarLimitations,
          dotypos,
          query,
        });
      const loadAdvisory = (
        query: Pick<WorkspaceAvailabilityQuery, "from" | "to">
      ) =>
        Effect.tryPromise({
          try: () => loadCachedWorkspaceAvailabilityInventory(query),
          catch: (cause) =>
            new WorkspaceAvailabilityInventoryCacheError({ cause }),
        });
      const invalidateAdvisory = () =>
        Effect.try({
          try: () =>
            revalidateTag(workspaceAvailabilityTags.all(), { expire: 0 }),
          catch: (cause) =>
            new WorkspaceAvailabilityInventoryCacheError({ cause }),
        });

      return { loadFresh, loadAdvisory, invalidateAdvisory };
    })
  );
}

export interface WorkspaceAvailabilityService {
  readonly getAvailability: (
    query: WorkspaceAvailabilityQuery
  ) => Effect.Effect<WorkspaceAvailability, WorkspaceAvailabilityError>;
  readonly getAdvisoryAvailability: (
    query: WorkspaceAvailabilityQuery
  ) => Effect.Effect<WorkspaceAvailability, WorkspaceAvailabilityError>;
  readonly ensureAvailable: (query: {
    readonly date: string;
    readonly entryTier: WorkspaceProductTier;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  }) => Effect.Effect<
    void,
    WorkspaceAvailabilityError | WorkspaceTableUnavailableError
  >;
}

export const WorkspaceAvailabilityService =
  Context.Service<WorkspaceAvailabilityService>("WorkspaceAvailabilityService");

export const WorkspaceAvailabilityServiceLive = Layer.effect(
  WorkspaceAvailabilityService,
  Effect.gen(function* () {
    const inventoryService = yield* WorkspaceAvailabilityInventoryService;
    const holdCleanup = yield* ReservationHoldCleanupService;

    const loadInventory = Effect.fn("workspaceAvailability.loadInventory")(
      function* (
        query: Pick<WorkspaceAvailabilityQuery, "from" | "to">,
        options: { readonly cached?: boolean } = {}
      ) {
        yield* Effect.logInfo("Workspace availability inventory load started");

        const sweepResult = yield* holdCleanup
          .sweepExpiredHolds({ now: new Date(), limit: 10 })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logWarning("Availability expired hold sweep failed", {
                cause,
              })
            ),
            Effect.result
          );
        yield* Effect.annotateLogsScoped({ sweepResult });
        yield* Effect.logInfo(
          "Workspace availability expired hold sweep completed"
        );

        const expiredHoldsWereCancelled =
          sweepResult._tag === "Success" && sweepResult.success.cancelled > 0;
        if (expiredHoldsWereCancelled) {
          yield* inventoryService.invalidateAdvisory();
        }

        const inventory =
          options.cached && !expiredHoldsWereCancelled
            ? yield* inventoryService.loadAdvisory(query)
            : yield* inventoryService.loadFresh(query);
        const { tables, reservations, limitations } = inventory;
        yield* Effect.annotateLogsScoped({ tables, reservations, limitations });
        yield* Effect.logInfo(
          "Workspace availability inventory load completed"
        );

        return { tables, reservations, limitations };
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

    const computeAvailability = Effect.fn("workspaceAvailability.compute")(
      function* (options: {
        readonly query: WorkspaceAvailabilityQuery;
        readonly cached?: boolean;
      }) {
        const { query } = options;
        yield* Effect.annotateLogsScoped({ query });
        yield* Effect.logInfo("Workspace availability computation started");

        const dates = yield* getDateRange(query.from, query.to);
        const date = query.date ? yield* parsePlainDate(query.date) : undefined;
        yield* Effect.annotateLogsScoped({ dates, date });

        const { tables, reservations, limitations } = yield* loadInventory(
          {
            from: query.from,
            to: query.to,
          },
          { cached: options.cached }
        );
        const fullyOccupiedDates = getFullyOccupiedCalendarDates(limitations);
        const occupancyByDate = new Map<string, Map<string, number>>();

        for (const day of dates) {
          occupancyByDate.set(
            plainDateToString(day),
            getWorkspaceTableOccupancyById(reservations, day)
          );
        }

        const unavailableDates = dates
          .map(plainDateToString)
          .filter(
            (day) =>
              fullyOccupiedDates.has(day) ||
              isUnavailableForSelection(
                tables,
                occupancyByDate.get(day) ?? new Map(),
                query.entryTier,
                query.monitorOption
              )
          );

        const selectedDateOccupancy = date
          ? getWorkspaceTableOccupancyById(reservations, date)
          : new Map<string, number>();

        const result = {
          date: query.date,
          from: query.from,
          to: query.to,
          unavailableDates,
          unavailableTiers: date
            ? workspaceProductTiers.filter((tier) =>
                isTierUnavailable(tables, selectedDateOccupancy, tier)
              )
            : [],
          unavailableMonitorOptions: date
            ? workspaceProductMonitorOptions.filter((option) =>
                isMonitorOptionUnavailable(
                  tables,
                  selectedDateOccupancy,
                  option
                )
              )
            : [],
          notices: getCalendarNotices(limitations),
        } satisfies WorkspaceAvailability;

        yield* Effect.annotateLogsScoped({ result });
        yield* Effect.logInfo("Workspace availability computed");

        return result;
      },
      (effect, options) =>
        effect.pipe(
          Effect.scoped,
          Effect.tapError((cause) =>
            Effect.logError("Workspace availability computation failed", {
              cause,
            })
          ),
          Effect.annotateLogs({
            date: options.query.date,
            from: options.query.from,
            to: options.query.to,
            entryTier: options.query.entryTier,
            monitorOption: options.query.monitorOption,
          })
        )
    );

    const getAvailability = Effect.fn("workspaceAvailability.getAvailability")(
      function* (query: WorkspaceAvailabilityQuery) {
        return yield* computeAvailability({ query });
      }
    );

    const getAdvisoryAvailability = Effect.fn(
      "workspaceAvailability.getAdvisoryAvailability"
    )(function* (query: WorkspaceAvailabilityQuery) {
      return yield* computeAvailability({ query, cached: true });
    });

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

        yield* Effect.logInfo("Workspace availability assurance failed");

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
      getAdvisoryAvailability,
      ensureAvailable,
    });
  })
);

const loadFreshWorkspaceAvailabilityInventory = ({
  calendarLimitations,
  dotypos,
  query,
}: {
  readonly calendarLimitations: IGoogleCalendarWorkspaceLimitationsService;
  readonly dotypos: WorkspaceAvailabilityDotyposInventoryService;
  readonly query: Pick<WorkspaceAvailabilityQuery, "from" | "to">;
}) =>
  Effect.all(
    [
      dotypos.getTables(),
      dotypos.listReservations(),
      calendarLimitations.listLimitations({
        from: query.from,
        to: query.to,
      }),
    ],
    { concurrency: 3 }
  ).pipe(
    Effect.map(
      ([
        tables,
        reservations,
        limitations,
      ]): WorkspaceAvailabilityInventory => ({
        tables,
        reservations,
        limitations,
      })
    )
  );

async function loadCachedWorkspaceAvailabilityInventory(
  query: Pick<WorkspaceAvailabilityQuery, "from" | "to">
): Promise<WorkspaceAvailabilityInventory> {
  "use cache";

  cacheLife({ stale: 30, revalidate: 60, expire: 300 });
  applyCacheTags(workspaceAvailabilityTags.all());

  return runWorkspaceEffectWithLogAnnotations(
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const calendarLimitations =
        yield* GoogleCalendarWorkspaceLimitationsService;

      return yield* loadFreshWorkspaceAvailabilityInventory({
        calendarLimitations,
        dotypos,
        query,
      });
    }).pipe(
      Effect.provide(GoogleCalendarWorkspaceLimitationsLive),
      Effect.provide(DotyposServiceLive),
      Effect.scoped
    ),
    { workspaceAvailabilityCache: "advisory" }
  );
}

const GoogleCalendarWorkspaceLimitationsLive =
  GoogleCalendarWorkspaceLimitationsService.Live.pipe(
    Layer.provide(GoogleCalendarServiceLive)
  );

export const WorkspaceAvailabilityInventoryServiceLiveWithDependencies =
  WorkspaceAvailabilityInventoryService.Live.pipe(
    Layer.provide(GoogleCalendarWorkspaceLimitationsLive),
    Layer.provide(DotyposServiceLive)
  );

export const WorkspaceAvailabilityServiceLiveWithDependencies =
  WorkspaceAvailabilityServiceLive.pipe(
    Layer.provide(ReservationHoldCleanupServiceLiveWithDependencies),
    Layer.provide(WorkspaceAvailabilityInventoryServiceLiveWithDependencies)
  );

const getFullyOccupiedCalendarDates = (
  limitations: readonly WorkspaceCalendarLimitationType[]
) =>
  new Set(
    limitations.flatMap((limitation) =>
      Match.value(limitation).pipe(
        Match.tag("FullyOccupied", ({ date }) => [date]),
        Match.orElse(() => [])
      )
    )
  );

const getCalendarNotices = (
  limitations: readonly WorkspaceCalendarLimitationType[]
): readonly WorkspaceAvailabilityNotice[] =>
  limitations
    .flatMap((limitation) =>
      Match.value(limitation).pipe(
        Match.tag("PartiallyOccupied", (partial) => [
          {
            date: partial.date,
            startsAt: partial.startsAt,
            endsAt: partial.endsAt,
            ...(partial.summary && { summary: partial.summary }),
          },
        ]),
        Match.orElse(() => [])
      )
    )
    .sort((a, b) =>
      a.date === b.date
        ? a.startsAt.localeCompare(b.startsAt)
        : a.date.localeCompare(b.date)
    );

const isUnavailableForSelection = (
  tables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>,
  tier?: WorkspaceProductTier,
  monitorOption?: WorkspaceProductMonitorOption
) => {
  if (!tier) {
    return workspaceProductTiers.every((candidateTier) =>
      isTierUnavailable(tables, occupancyByTableId, candidateTier)
    );
  }

  const product = getWorkspaceProductByTier(tier);
  if (!product.requiresMonitorOption) {
    return isTierUnavailable(tables, occupancyByTableId, tier);
  }

  if (monitorOption) {
    return isMonitorOptionUnavailable(
      tables,
      occupancyByTableId,
      monitorOption
    );
  }

  return product.allowedMonitorOptions.every((option) =>
    isMonitorOptionUnavailable(tables, occupancyByTableId, option)
  );
};

const isTierUnavailable = (
  tables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>,
  tier: WorkspaceProductTier
) => {
  const product = getWorkspaceProductByTier(tier);

  if (product.requiresMonitorOption) {
    return product.allowedMonitorOptions.every((option) =>
      isMonitorOptionUnavailable(tables, occupancyByTableId, option)
    );
  }

  return !hasAvailableWorkspaceTableCandidate(
    tables,
    [`tier:${tier}`],
    occupancyByTableId,
    workspaceBookingGuestCount
  );
};

const isMonitorOptionUnavailable = (
  tables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>,
  monitorOption: WorkspaceProductMonitorOption
) =>
  !hasAvailableWorkspaceTableCandidate(
    tables,
    ["tier:profi", ...workspaceProductMonitorOptionTableTags[monitorOption]],
    occupancyByTableId,
    workspaceBookingGuestCount
  );

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
