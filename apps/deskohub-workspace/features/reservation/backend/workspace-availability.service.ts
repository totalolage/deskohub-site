import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { Table } from "@deskohub/dotypos/generated";
import type { GoogleCalendarError } from "@deskohub/google-calendar";
import { Context, Data, Effect, Layer, Match } from "effect";
import {
  type DatabaseError,
  WorkspaceDatabaseLive,
} from "@/db/database.service";
import {
  excludeExpiredLocalHolds,
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
import type {
  WorkspaceAvailability,
  WorkspaceAvailabilityNotice,
  WorkspaceAvailabilityQuery,
} from "../schemas/workspace-availability";
import {
  GoogleCalendarWorkspaceLimitationsService,
  type WorkspaceCalendarLimitation as WorkspaceCalendarLimitationType,
} from "./google-calendar-workspace-limitations.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "./workspace-reservation.repository";

type WorkspaceAvailabilityError =
  | DatabaseError
  | ExternalAPIError
  | GoogleCalendarError
  | NetworkError
  | ValidationError;

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
    const dotypos = yield* DotyposService;
    const workspaceReservations = yield* WorkspaceReservationRepository;
    const calendarLimitations =
      yield* GoogleCalendarWorkspaceLimitationsService;

    const loadInventory = Effect.fn("workspaceAvailability.loadInventory")(
      function* (query: Pick<WorkspaceAvailabilityQuery, "from" | "to">) {
        yield* Effect.logInfo("Workspace availability inventory load started");

        const [
          tables,
          reservations,
          limitations,
          expiredDotyposReservationIds,
        ] = yield* Effect.all([
          dotypos.getTables(),
          dotypos.listReservations(),
          calendarLimitations.listLimitations({
            from: query.from,
            to: query.to,
          }),
          workspaceReservations
            .selectExpiredHoldDotyposReservationIds({
              now: new Date(),
            })
            .pipe(
              Effect.tapError((cause) =>
                Effect.logWarning(
                  "Workspace availability expired hold filter failed",
                  { cause }
                )
              ),
              Effect.orElseSucceed(() => [] as readonly string[])
            ),
        ]);
        const activeReservations = excludeExpiredLocalHolds(
          reservations,
          expiredDotyposReservationIds
        );
        yield* Effect.annotateLogsScoped({ tables, reservations, limitations });
        yield* Effect.logInfo(
          "Workspace availability inventory load completed"
        );

        return { tables, reservations: activeReservations, limitations };
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

        const { tables, reservations, limitations } = yield* loadInventory({
          from: query.from,
          to: query.to,
        });
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
      ensureAvailable,
    });
  })
);

const GoogleCalendarWorkspaceLimitationsLive =
  GoogleCalendarWorkspaceLimitationsService.Live.pipe(
    Layer.provide(GoogleCalendarServiceLive)
  );

export const WorkspaceAvailabilityServiceLiveWithDependencies =
  WorkspaceAvailabilityServiceLive.pipe(
    Layer.provide(GoogleCalendarWorkspaceLimitationsLive),
    Layer.provide(DotyposServiceLive),
    Layer.provide(
      WorkspaceReservationRepositoryLive.pipe(
        Layer.provide(WorkspaceDatabaseLive)
      )
    )
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
