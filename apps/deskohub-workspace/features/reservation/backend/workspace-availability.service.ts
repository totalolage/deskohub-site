import {
  type DotyposReservationInterval,
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
  excludeDotyposReservationsById,
  getWorkspaceTableOccupancyById,
  hasAvailableWorkspaceTableCandidate,
  workspaceBookingSeatCount,
  workspaceMeetingRoomReservationTableTag,
  workspaceOfficeReservationTableTag,
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
  officeReservationKind,
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
      readonly entryTier: WorkspaceCoworkProductTier;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    }
  | {
      readonly kind: typeof meetingRoomReservationKind;
    }
  | {
      readonly kind: typeof officeReservationKind;
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
    } & ReservationInterval)
  | ({
      readonly kind: typeof officeReservationKind;
      readonly seats: number;
    } & ReservationInterval);

export interface IWorkspaceAvailabilityService {
  readonly getAvailability: (
    input: WorkspaceAvailabilityRequest
  ) => Effect.Effect<WorkspaceAvailability, WorkspaceAvailabilityError>;
  readonly ensureAvailable: (
    query: WorkspaceAvailabilityEnsureQuery
  ) => Effect.Effect<
    void,
    WorkspaceAvailabilityError | WorkspaceTableUnavailableError
  >;
}

export type WorkspaceAvailabilityOccupancyExclusion = {
  readonly dotyposReservationId: string;
};

type WorkspaceAvailabilityRequest = {
  readonly query: WorkspaceAvailabilityQuery;
  readonly occupancyExclusion?: WorkspaceAvailabilityOccupancyExclusion;
};

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
    function* (
      input: WorkspaceAvailabilityRequest & {
        readonly reservationInterval: DotyposReservationInterval;
      }
    ) {
      yield* Effect.logInfo("Workspace availability inventory load started");

      const [tables, reservations, limitations, expiredDotyposReservationIds] =
        yield* Effect.all(
          [
            dotypos.getTables(),
            dotypos.listActiveReservationsOverlapping(
              input.reservationInterval
            ),
            calendarLimitations.listLimitations({
              from: input.query.from,
              to: input.query.to,
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
      const replacementReservationId =
        input.occupancyExclusion?.dotyposReservationId;
      const replacementIsPending = reservations.some(
        (reservation) =>
          reservation.id === replacementReservationId &&
          reservation.status === "NEW"
      );
      const activeReservations = excludeDotyposReservationsById(reservations, [
        ...expiredDotyposReservationIds,
        ...(replacementIsPending && replacementReservationId
          ? [replacementReservationId]
          : []),
      ]);
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
    function* (input: WorkspaceAvailabilityRequest) {
      const { query } = input;
      yield* Effect.annotateLogsScoped({ query });
      yield* Effect.logInfo("Workspace availability computation started");

      const dates = yield* getDateRange(query.from, query.to);
      const reservationInterval = getDateRangeReservationInterval(dates);
      const reservation = yield* getAvailabilityReservation(query);
      const selectedDate = reservation
        ? getReservationDate({
            interval: reservation,
            timeZone: workspaceSiteConstants.location.timeZone,
          })
        : undefined;
      yield* Effect.annotateLogsScoped({ dates, selectedDate });

      const { tables, reservations, limitations } = yield* loadInventory({
        ...input,
        reservationInterval,
      });
      const fullyOccupiedDates = getFullyOccupiedCalendarDates(limitations);
      const occupancyByDate = new Map<string, Map<string, number>>();
      const shouldCheckRangeDateSelection =
        query.kind === officeReservationKind ||
        !reservation ||
        isSingleDayReservationInterval(reservation);

      for (const day of dates) {
        const dayKey = plainDateToString(day);
        const interval =
          query.kind !== officeReservationKind &&
          reservation &&
          dayKey === selectedDate
            ? reservation
            : yield* normalizeCoworkAvailabilityInterval(dayKey);
        occupancyByDate.set(
          dayKey,
          getWorkspaceTableOccupancyById(reservations, interval)
        );
      }

      const unavailableDates: string[] = [];
      for (const day of dates.map(plainDateToString)) {
        if (fullyOccupiedDates.has(day)) {
          unavailableDates.push(day);
          continue;
        }
        if (
          (shouldCheckRangeDateSelection || day === selectedDate) &&
          (yield* isUnavailableForSelection(
            tables,
            occupancyByDate.get(day) ?? new Map(),
            query
          ))
        ) {
          unavailableDates.push(day);
        }
      }

      const selectedDateOccupancy = selectedDate
        ? (occupancyByDate.get(selectedDate) ?? new Map<string, number>())
        : new Map<string, number>();
      const selectedOfficeRangeOccupancy =
        query.kind === officeReservationKind && reservation
          ? getWorkspaceTableOccupancyById(reservations, reservation)
          : selectedDateOccupancy;

      const unavailableCoworkTiers = selectedDate
        ? yield* Effect.filter(workspaceCoworkTiers, (tier) =>
            isTierUnavailable(tables, selectedDateOccupancy, tier)
          )
        : [];
      const meetingRoomUnavailable = selectedDate
        ? yield* isMeetingRoomUnavailable(tables, selectedDateOccupancy)
        : false;
      const officeUnavailable =
        query.kind === officeReservationKind && selectedDate
          ? yield* isOfficeUnavailable(
              tables,
              selectedOfficeRangeOccupancy,
              query.seats ?? workspaceBookingSeatCount
            )
          : false;
      const unavailableMonitorOptions = selectedDate
        ? yield* Effect.filter(workspaceProductMonitorOptions, (option) =>
            isMonitorOptionUnavailable(tables, selectedDateOccupancy, option)
          )
        : [];

      const result = {
        date: selectedDate,
        from: query.from,
        to: query.to,
        unavailableDates,
        unavailableCoworkTiers,
        meetingRoomUnavailable,
        officeUnavailable,
        unavailableMonitorOptions,
        notices: getCalendarNotices(limitations),
      } satisfies WorkspaceAvailability;

      yield* Effect.annotateLogsScoped({ result });
      yield* Effect.logInfo("Workspace availability computed");

      return result;
    },
    (effect, input) =>
      effect.pipe(
        Effect.scoped,
        Effect.tapError((cause) =>
          Effect.logError("Workspace availability computation failed", {
            cause,
          })
        ),
        Effect.annotateLogs({
          from: input.query.from,
          to: input.query.to,
          ...Match.value(input.query).pipe(
            Match.discriminatorsExhaustive("kind")({
              "meeting-room": (meetingRoomQuery) => ({
                startsAt: meetingRoomQuery.startsAt,
                endsAt: meetingRoomQuery.endsAt,
              }),
              cowork: (coworkQuery) => ({
                entryTier: coworkQuery.entryTier,
                monitorOption: coworkQuery.monitorOption,
              }),
              office: (officeQuery) => ({
                startsAt: officeQuery.startsAt,
                endsAt: officeQuery.endsAt,
                seats: officeQuery.seats,
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
          office: ({ startsAt, endsAt }) =>
            normalizeMeetingRoomAvailabilityInterval({ startsAt, endsAt }),
        })
      );
      const availabilityRange =
        getAvailabilityTouchedDateRange(reservationInterval);
      const availability = yield* getAvailability({
        query: {
          ...query,
          from: availabilityRange.from,
          to: availabilityRange.to,
        },
      });
      yield* Effect.annotateLogsScoped({ availability });

      const unavailableDate = availability.unavailableDates[0];
      const officeUnavailable =
        query.kind === officeReservationKind && availability.officeUnavailable;
      if (!unavailableDate && !officeUnavailable) {
        yield* Effect.logDebug("Workspace availability assurance passed");
        return;
      }

      yield* Effect.logInfo("Workspace availability assurance failed");

      return yield* new WorkspaceTableUnavailableError({
        date: unavailableDate ?? availabilityRange.from,
        reservation: Match.value(query).pipe(
          Match.discriminatorsExhaustive("kind")({
            "meeting-room": () => ({
              kind: meetingRoomReservationKind,
            }),
            cowork: (coworkQuery) => ({
              kind: coworkReservationKind,
              entryTier: coworkQuery.entryTier,
              ...(coworkQuery.monitorOption && {
                monitorOption: coworkQuery.monitorOption,
              }),
            }),
            office: () => ({ kind: officeReservationKind }),
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
      office: ({ seats }) =>
        isOfficeUnavailable(
          tables,
          occupancyByTableId,
          seats ?? workspaceBookingSeatCount
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
    return Effect.forEach(workspaceCoworkTiers, (candidateTier) =>
      isTierUnavailable(tables, occupancyByTableId, candidateTier)
    ).pipe(Effect.map((unavailable) => unavailable.every(Boolean)));
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

  return Effect.forEach(product.allowedMonitorOptions, (option) =>
    isMonitorOptionUnavailable(tables, occupancyByTableId, option)
  ).pipe(Effect.map((unavailable) => unavailable.every(Boolean)));
};

const isTierUnavailable = (
  tables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>,
  tier: WorkspaceCoworkProductTier
) => {
  const product = getWorkspaceProductByTier(tier);

  if (product.requiresMonitorOption) {
    return Effect.forEach(product.allowedMonitorOptions, (option) =>
      isMonitorOptionUnavailable(tables, occupancyByTableId, option)
    ).pipe(Effect.map((unavailable) => unavailable.every(Boolean)));
  }

  return hasAvailableWorkspaceTableCandidate(
    tables,
    [`tier:${tier}`],
    occupancyByTableId,
    workspaceBookingSeatCount
  ).pipe(Effect.map((available) => !available));
};

const isMeetingRoomUnavailable = (
  tables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>
) =>
  hasAvailableWorkspaceTableCandidate(
    tables,
    [workspaceMeetingRoomReservationTableTag],
    occupancyByTableId,
    workspaceBookingSeatCount,
    true
  ).pipe(Effect.map((available) => !available));

const isOfficeUnavailable = (
  tables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>,
  seats: number
) =>
  hasAvailableWorkspaceTableCandidate(
    tables,
    [workspaceOfficeReservationTableTag],
    occupancyByTableId,
    seats,
    true
  ).pipe(Effect.map((available) => !available));

const isMonitorOptionUnavailable = (
  tables: readonly Table[],
  occupancyByTableId: ReadonlyMap<string, number>,
  monitorOption: WorkspaceProductMonitorOption
) =>
  hasAvailableWorkspaceTableCandidate(
    tables,
    ["tier:profi", ...workspaceProductMonitorOptionTableTags[monitorOption]],
    occupancyByTableId,
    workspaceBookingSeatCount
  ).pipe(Effect.map((available) => !available));

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

const getDateRangeReservationInterval = (
  dates: readonly Temporal.PlainDate[]
): DotyposReservationInterval => {
  const timeZone = workspaceSiteConstants.location.timeZone;
  const firstDate = dates[0]!;
  const lastDate = dates.at(-1)!;
  return {
    startDate: new Date(
      firstDate.toZonedDateTime(timeZone).toInstant().epochMilliseconds
    ),
    endDate: new Date(
      lastDate.add({ days: 1 }).toZonedDateTime(timeZone).toInstant()
        .epochMilliseconds
    ),
  };
};

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
      office: ({ startsAt, endsAt }) =>
        startsAt && endsAt
          ? normalizeMeetingRoomAvailabilityInterval({ startsAt, endsAt })
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
