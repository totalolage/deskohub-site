import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { Table } from "@deskohub/dotypos/generated";
import type { GoogleCalendarError } from "@deskohub/google-calendar";
import { Context, Data, Effect, Layer, Match } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import {
  excludeExpiredLocalHolds,
  getWorkspaceTableOccupancyById,
  hasAvailableWorkspaceTableCandidate,
  workspaceBookingGuestCount,
  workspaceMeetingRoomReservationTableTag,
} from "@/features/checkout/backend/reservation";
import {
  getWorkspaceProductByTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkTiers,
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import { getCoworkReservationIntervalInput } from "@/features/reservation/cowork-reservation";
import {
  coworkReservationKind,
  meetingRoomReservationKind,
} from "@/features/reservation/reservation-kind";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { GoogleCalendarServiceLive } from "@/shared/backend/config/google-calendar.config";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  getReservationDate,
  isSingleDayReservationInterval,
  normalizeReservationInterval,
  type ReservationInterval,
  type ReservationIntervalError,
  type ReservationIntervalInput,
} from "../reservation-interval";
import type {
  WorkspaceAvailability,
  WorkspaceAvailabilityNotice,
  WorkspaceAvailabilityQuery,
} from "../workspace-availability";
import {
  GoogleCalendarWorkspaceLimitationsService,
  type WorkspaceCalendarLimitation as WorkspaceCalendarLimitationType,
} from "./google-calendar-workspace-limitations.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "./workspace-reservation.repository";

type WorkspaceAvailabilityError =
  | ExternalAPIError
  | GoogleCalendarError
  | NetworkError
  | ValidationError;

type WorkspaceTableUnavailableReservation =
  | {
      readonly kind: typeof coworkReservationKind;
      readonly tier: WorkspaceCoworkProductTier;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    }
  | {
      readonly kind: typeof meetingRoomReservationKind;
    };

export class WorkspaceTableUnavailableError extends Data.TaggedError(
  "WorkspaceTableUnavailableError"
)<{
  readonly date: string;
  readonly reservation: WorkspaceTableUnavailableReservation;
}> {}

type WorkspaceAvailabilityEnsureQuery =
  | {
      readonly kind: typeof coworkReservationKind;
      readonly date: string;
      readonly entryTier: WorkspaceCoworkProductTier;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    }
  | ({
      readonly kind: typeof meetingRoomReservationKind;
    } & ReservationInterval);

export interface IWorkspaceAvailabilityService {
  readonly getAvailability: (
    query: WorkspaceAvailabilityQuery
  ) => Effect.Effect<WorkspaceAvailability, WorkspaceAvailabilityError>;
  readonly ensureAvailable: (
    query: WorkspaceAvailabilityEnsureQuery
  ) => Effect.Effect<
    void,
    WorkspaceAvailabilityError | WorkspaceTableUnavailableError
  >;
}

const GoogleCalendarWorkspaceLimitationsLive =
  GoogleCalendarWorkspaceLimitationsService.Live.pipe(
    Layer.provide(GoogleCalendarServiceLive),
    Layer.provide(CalendarResourceConfig.Live)
  );

const implementation = Effect.gen(function* () {
  const dotypos = yield* DotyposService;
  const workspaceReservations = yield* WorkspaceReservationRepository;
  const calendarLimitations = yield* GoogleCalendarWorkspaceLimitationsService;

  const loadInventory = Effect.fn("workspaceAvailability.loadInventory")(
    function* (query: Pick<WorkspaceAvailabilityQuery, "from" | "to">) {
      yield* Effect.logInfo("Workspace availability inventory load started");

      const [tables, reservations, limitations, expiredDotyposReservationIds] =
        yield* Effect.all(
          [
            dotypos.getTables(),
            dotypos.listReservations(),
            calendarLimitations.listLimitations({
              from: query.from,
              to: query.to,
            }),
            workspaceReservations
              .selectExpiredHoldDotyposReservationIds({
                now: Temporal.Now.instant(),
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
          ],
          { concurrency: "inherit" }
        );
      const activeReservations = excludeExpiredLocalHolds(
        reservations,
        expiredDotyposReservationIds
      );
      yield* Effect.annotateLogsScoped({
        tables,
        reservations,
        limitations,
      });
      yield* Effect.logInfo("Workspace availability inventory load completed");

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
      const reservation = yield* getAvailabilityReservation(query);
      const selectedDate = reservation
        ? getReservationDate({
            interval: reservation,
            timeZone: workspaceSiteConstants.location.timeZone,
          })
        : undefined;
      yield* Effect.annotateLogsScoped({ dates, selectedDate });

      const { tables, reservations, limitations } = yield* loadInventory({
        from: query.from,
        to: query.to,
      });
      const fullyOccupiedDates = getFullyOccupiedCalendarDates(limitations);
      const occupancyByDate = new Map<string, Map<string, number>>();
      const shouldCheckRangeDateSelection =
        !reservation || isSingleDayReservationInterval(reservation);

      for (const day of dates) {
        const dayKey = plainDateToString(day);
        const interval =
          reservation && dayKey === selectedDate
            ? reservation
            : yield* normalizeCoworkAvailabilityInterval(dayKey);
        occupancyByDate.set(
          dayKey,
          getWorkspaceTableOccupancyById(reservations, interval)
        );
      }

      const unavailableDates = dates
        .map(plainDateToString)
        .filter(
          (day) =>
            fullyOccupiedDates.has(day) ||
            (shouldCheckRangeDateSelection || day === selectedDate
              ? isUnavailableForSelection(
                  tables,
                  occupancyByDate.get(day) ?? new Map(),
                  query
                )
              : false)
        );

      const selectedDateOccupancy = selectedDate
        ? (occupancyByDate.get(selectedDate) ?? new Map<string, number>())
        : new Map<string, number>();

      const result = {
        date: selectedDate,
        from: query.from,
        to: query.to,
        unavailableDates,
        unavailableCoworkTiers: selectedDate
          ? workspaceCoworkTiers.filter((tier) =>
              isTierUnavailable(tables, selectedDateOccupancy, tier)
            )
          : [],
        meetingRoomUnavailable: selectedDate
          ? isMeetingRoomUnavailable(tables, selectedDateOccupancy)
          : false,
        unavailableMonitorOptions: selectedDate
          ? workspaceProductMonitorOptions.filter((option) =>
              isMonitorOptionUnavailable(tables, selectedDateOccupancy, option)
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
          from: query.from,
          to: query.to,
          ...Match.value(query).pipe(
            Match.discriminatorsExhaustive("kind")({
              "meeting-room": (meetingRoomQuery) => ({
                startsAt: meetingRoomQuery.startsAt,
                endsAt: meetingRoomQuery.endsAt,
              }),
              cowork: (coworkQuery) => ({
                entryTier: coworkQuery.entryTier,
                monitorOption: coworkQuery.monitorOption,
              }),
            })
          ),
        })
      )
  );

  const ensureAvailable = Effect.fn("workspaceAvailability.ensureAvailable")(
    function* (query: WorkspaceAvailabilityEnsureQuery) {
      yield* Effect.annotateLogsScoped({ query });
      yield* Effect.logInfo("Workspace availability assurance started");

      const reservationInterval = yield* Match.value(query).pipe(
        Match.discriminatorsExhaustive("kind")({
          "meeting-room": ({ startsAt, endsAt }) =>
            normalizeMeetingRoomAvailabilityInterval({ startsAt, endsAt }),
          cowork: ({ date }) => normalizeCoworkAvailabilityInterval(date),
        })
      );
      const availabilityRange =
        getAvailabilityTouchedDateRange(reservationInterval);
      const availability = yield* getAvailability({
        ...query,
        from: availabilityRange.from,
        to: availabilityRange.to,
      });
      yield* Effect.annotateLogsScoped({ availability });

      const unavailableDate = availability.unavailableDates[0];
      if (!unavailableDate) {
        yield* Effect.logDebug("Workspace availability assurance passed");
        return;
      }

      yield* Effect.logInfo("Workspace availability assurance failed");

      return yield* new WorkspaceTableUnavailableError({
        date: unavailableDate,
        reservation: Match.value(query).pipe(
          Match.discriminatorsExhaustive("kind")({
            "meeting-room": () => ({
              kind: meetingRoomReservationKind,
            }),
            cowork: (coworkQuery) => ({
              kind: coworkReservationKind,
              tier: coworkQuery.entryTier,
              ...(coworkQuery.monitorOption && {
                monitorOption: coworkQuery.monitorOption,
              }),
            }),
          })
        ),
      });
    },
    (effect) => effect.pipe(Effect.scoped)
  );

  return {
    getAvailability,
    ensureAvailable,
  };
});

export class WorkspaceAvailabilityService extends Context.Service<
  WorkspaceAvailabilityService,
  IWorkspaceAvailabilityService
>()("@deskohub-workspace/reservation/WorkspaceAvailabilityService") {
  static Live = Layer.effect(this, implementation);

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(GoogleCalendarWorkspaceLimitationsLive),
    Layer.provide(DotyposServiceLive),
    Layer.provide(
      WorkspaceReservationRepositoryLive.pipe(
        Layer.provide(WorkspaceDatabaseLive)
      )
    )
  );
}

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
  query: WorkspaceAvailabilityQuery
) =>
  Match.value(query).pipe(
    Match.discriminatorsExhaustive("kind")({
      "meeting-room": () =>
        isMeetingRoomUnavailableForSelection(tables, occupancyByTableId),
      cowork: (coworkQuery) =>
        isCoworkUnavailableForSelection(
          tables,
          occupancyByTableId,
          coworkQuery
        ),
    })
  );

const isMeetingRoomUnavailableForSelection = (
  tables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>
) => isMeetingRoomUnavailable(tables, occupancyByTableId);

const isCoworkUnavailableForSelection = (
  tables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>,
  query: Extract<WorkspaceAvailabilityQuery, { readonly kind: "cowork" }>
) => {
  const { entryTier, monitorOption } = query;

  if (!entryTier) {
    return workspaceCoworkTiers.every((candidateTier) =>
      isTierUnavailable(tables, occupancyByTableId, candidateTier)
    );
  }

  const product = getWorkspaceProductByTier(entryTier);
  if (!product.requiresMonitorOption) {
    return isTierUnavailable(tables, occupancyByTableId, entryTier);
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
  tier: WorkspaceCoworkProductTier
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

const isMeetingRoomUnavailable = (
  tables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>
) =>
  !hasAvailableWorkspaceTableCandidate(
    tables,
    [workspaceMeetingRoomReservationTableTag],
    occupancyByTableId,
    workspaceBookingGuestCount,
    true
  );

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

const getAvailabilityReservation = (
  query: WorkspaceAvailabilityQuery
): Effect.Effect<ReservationInterval | undefined, ValidationError> =>
  Match.value(query).pipe(
    Match.discriminatorsExhaustive("kind")({
      "meeting-room": ({ startsAt, endsAt }) =>
        startsAt && endsAt
          ? normalizeMeetingRoomAvailabilityInterval({ startsAt, endsAt })
          : Effect.void.pipe(Effect.as(undefined)),
      cowork: ({ date }) =>
        date
          ? normalizeCoworkAvailabilityInterval(date)
          : Effect.void.pipe(Effect.as(undefined)),
    })
  );

const normalizeMeetingRoomAvailabilityInterval = (
  interval: ReservationIntervalInput
) =>
  normalizeReservationInterval(interval).pipe(
    Effect.mapError(toAvailabilityIntervalError)
  );

const normalizeCoworkAvailabilityInterval = (date: string) =>
  normalizeReservationInterval(getCoworkReservationIntervalInput(date)).pipe(
    Effect.mapError((error) =>
      toAvailabilityIntervalError(error, ` for date: ${date}`)
    )
  );

const getAvailabilityTouchedDateRange = (input: ReservationInterval) => {
  const from = getReservationDate({
    interval: input,
    timeZone: workspaceSiteConstants.location.timeZone,
  });
  const to = Temporal.Instant.fromEpochMilliseconds(
    Temporal.Instant.from(input.endsAt).epochMilliseconds - 1
  )
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .toString();

  return { from, to };
};

const toAvailabilityIntervalError = (
  _error: ReservationIntervalError,
  context = ""
) =>
  new ValidationError({
    message: `Availability interval must be valid${context}.`,
  });

const plainDateToString = (date: Temporal.PlainDate) => date.toString();
