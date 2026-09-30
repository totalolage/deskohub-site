import {
  type DotyposReservationId,
  type DotyposReservationInterval,
  DotyposService,
  type DotyposTable,
  type DotyposTableId,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { GoogleCalendarError } from "@deskohub/google-calendar";
import { Context, Data, Effect, Layer, Match } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  excludeDotyposReservationsById,
  getWorkspaceTableOccupancyById,
  hasAvailableWorkspaceTableCandidate,
  hasAvailableWorkspaceTableCandidateByPredicate,
  isWorkspaceCoworkTableCandidate,
  type WorkspaceCoworkTableCandidateQuery,
  workspaceBookingSeatCount,
  workspaceMeetingRoomReservationTableTag,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation";
import {
  isWorkspaceCoworkCurrentProductTier,
  type WorkspaceCoworkProductTier,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import { getCoworkReservationIntervalInput } from "@/features/reservation/cowork-reservation";
import {
  coworkReservationKind,
  meetingRoomReservationKind,
  officeReservationKind,
} from "@/features/reservation/reservation-kind";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  getReservationDate,
  isCoworkReservationInterval,
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
  WorkspaceAvailabilityUnavailableTarget,
} from "../workspace-availability";
import {
  GoogleCalendarWorkspaceLimitationsService,
  type WorkspaceCalendarLimitation as WorkspaceCalendarLimitationType,
} from "./google-calendar-workspace-limitations.service";
import { WorkspaceReservationRepository } from "./workspace-reservation.repository";

type WorkspaceAvailabilityError =
  | ExternalAPIError
  | GoogleCalendarError
  | NetworkError
  | ValidationError;

export class WorkspaceTableUnavailableError extends Data.TaggedError(
  "WorkspaceTableUnavailableError"
)<{
  readonly date: string;
  readonly reservation: WorkspaceAvailabilityUnavailableTarget;
}> {}

type CoworkWorkspaceAvailabilityEnsureQuery = Extract<
  WorkspaceAvailabilityUnavailableTarget,
  { readonly kind: typeof coworkReservationKind }
> & { readonly date: string };

type MeetingRoomWorkspaceAvailabilityEnsureQuery = Extract<
  WorkspaceAvailabilityUnavailableTarget,
  { readonly kind: typeof meetingRoomReservationKind }
> &
  ReservationInterval;

type OfficeWorkspaceAvailabilityEnsureQuery = Extract<
  WorkspaceAvailabilityUnavailableTarget,
  { readonly kind: typeof officeReservationKind }
> & { readonly seats: number } & ReservationInterval;

type WorkspaceAvailabilityEnsureQuery =
  | CoworkWorkspaceAvailabilityEnsureQuery
  | MeetingRoomWorkspaceAvailabilityEnsureQuery
  | OfficeWorkspaceAvailabilityEnsureQuery;

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
  readonly dotyposReservationId: DotyposReservationId;
};

type WorkspaceAvailabilityRequest = {
  readonly query: WorkspaceAvailabilityQuery;
  readonly occupancyExclusion?: WorkspaceAvailabilityOccupancyExclusion;
};

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
                Effect.orElseSucceed((): readonly DotyposReservationId[] => [])
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
      const occupancyByDate = new Map<string, Map<DotyposTableId, number>>();
      const shouldCheckRangeDateSelection =
        query.kind === officeReservationKind ||
        !reservation ||
        (query.kind === coworkReservationKind
          ? isCoworkReservationInterval(reservation)
          : isSingleDayReservationInterval(reservation));

      for (const day of dates) {
        const dayKey = plainDateToString(day);
        const interval =
          query.kind !== officeReservationKind &&
          reservation &&
          dayKey === selectedDate
            ? reservation
            : yield* normalizeCoworkAvailabilityInterval(
                dayKey,
                query.kind === coworkReservationKind
                  ? query.entryTier
                  : undefined
              );
        occupancyByDate.set(
          dayKey,
          getWorkspaceTableOccupancyById(reservations, interval)
        );
      }

      const unavailableDates: string[] = [];
      // Alternative tier, monitor-option, and bare range-selection checks
      // each use the candidate offer's OWN authoritative interval; the
      // selected offer's interval must not leak into them (a 00:00-17:00 Open
      // Space occupancy and a full-day Reserved Desk occupancy describe
      // different intervals).
      const getCoworkOfferOccupancy = (
        date: string,
        tier: WorkspaceCoworkProductTier
      ) =>
        normalizeCoworkAvailabilityInterval(date, tier).pipe(
          Effect.map((interval) =>
            getWorkspaceTableOccupancyById(reservations, interval)
          )
        );
      const reservedDeskWorkstationRequiredDates: string[] = [];
      if (query.kind === coworkReservationKind) {
        for (const day of dates.map(plainDateToString)) {
          if (fullyOccupiedDates.has(day)) continue;

          const reservedDeskOccupancy = yield* getCoworkOfferOccupancy(
            day,
            "reserved-desk"
          );
          const bareReservedDeskUnavailable = yield* isCoworkOfferUnavailable(
            tables,
            reservedDeskOccupancy,
            { entryTier: "reserved-desk" }
          );
          if (!bareReservedDeskUnavailable) continue;

          const unavailableMonitorOptions = yield* Effect.forEach(
            workspaceProductMonitorOptions,
            (monitorOption) =>
              isCoworkOfferUnavailable(tables, reservedDeskOccupancy, {
                entryTier: "reserved-desk",
                monitorOption,
              })
          );
          if (unavailableMonitorOptions.some((unavailable) => !unavailable)) {
            reservedDeskWorkstationRequiredDates.push(day);
          }
        }
      }

      for (const day of dates.map(plainDateToString)) {
        if (fullyOccupiedDates.has(day)) {
          unavailableDates.push(day);
          continue;
        }
        if (!(shouldCheckRangeDateSelection || day === selectedDate)) continue;
        if (
          yield* isUnavailableForSelection(
            tables,
            occupancyByDate.get(day) ?? new Map<DotyposTableId, number>(),
            query,
            (tier) => getCoworkOfferOccupancy(day, tier)
          )
        ) {
          unavailableDates.push(day);
        }
      }

      const selectedDateOccupancy = selectedDate
        ? (occupancyByDate.get(selectedDate) ??
          new Map<DotyposTableId, number>())
        : new Map<DotyposTableId, number>();
      const selectedOfficeRangeOccupancy =
        query.kind === officeReservationKind && reservation
          ? getWorkspaceTableOccupancyById(reservations, reservation)
          : selectedDateOccupancy;

      const unavailableCoworkTiers = selectedDate
        ? yield* Effect.filter(workspaceCoworkCurrentTiers, (tier) =>
            Effect.flatMap(
              getCoworkOfferOccupancy(selectedDate, tier),
              (occupancy) =>
                isCoworkCategoryUnavailable(tables, occupancy, tier)
            )
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
            Effect.flatMap(
              getCoworkOfferOccupancy(selectedDate, "reserved-desk"),
              (occupancy) =>
                isCoworkOfferUnavailable(tables, occupancy, {
                  entryTier: "reserved-desk",
                  monitorOption: option,
                })
            )
          )
        : [];

      const result = {
        date: selectedDate,
        from: query.from,
        to: query.to,
        unavailableDates,
        reservedDeskWorkstationRequiredDates,
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
          cowork: ({ date, entryTier }) =>
            normalizeCoworkAvailabilityInterval(date, entryTier),
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
  static Default = Layer.effect(this, implementation);

  static Live = this.Default.pipe(
    Layer.provide(GoogleCalendarWorkspaceLimitationsService.Live),
    Layer.provide(WorkspaceDotyposLayer),
    Layer.provide(
      WorkspaceReservationRepository.Default.pipe(
        Layer.provide(WorkspaceDatabase.Default)
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
  tables: readonly DotyposTable[],
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>,
  query: WorkspaceAvailabilityQuery,
  getCoworkOfferOccupancy: (
    tier: WorkspaceCoworkProductTier
  ) => Effect.Effect<ReadonlyMap<DotyposTableId, number>, ValidationError>
) =>
  Match.value(query).pipe(
    Match.discriminatorsExhaustive("kind")({
      "meeting-room": () =>
        isMeetingRoomUnavailableForSelection(tables, occupancyByTableId),
      cowork: (coworkQuery) =>
        isCoworkUnavailableForSelection(
          tables,
          occupancyByTableId,
          coworkQuery,
          getCoworkOfferOccupancy
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
  tables: readonly DotyposTable[],
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>
) => isMeetingRoomUnavailable(tables, occupancyByTableId);

const isCoworkUnavailableForSelection = (
  tables: readonly DotyposTable[],
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>,
  query: Extract<WorkspaceAvailabilityQuery, { readonly kind: "cowork" }>,
  getOfferOccupancy: (
    tier: WorkspaceCoworkProductTier
  ) => Effect.Effect<ReadonlyMap<DotyposTableId, number>, ValidationError>
) => {
  const { entryTier, monitorOption } = query;

  // A bare query offers every current category, so each category is judged
  // with its OWN authoritative interval occupancy (Open Space 00:00-17:00;
  // Reserved Desk full Prague day, including every eligible workstation
  // configuration). The date is unavailable only when no category has an
  // open offer — never because one category's interval looks full.
  if (!entryTier) {
    return Effect.forEach(workspaceCoworkCurrentTiers, (candidateTier) =>
      Effect.flatMap(getOfferOccupancy(candidateTier), (offerOccupancy) =>
        isCoworkCategoryUnavailable(tables, offerOccupancy, candidateTier)
      )
    ).pipe(Effect.map((unavailable) => unavailable.every(Boolean)));
  }

  // Legacy tiers are only ever re-checked on historical recovery paths and
  // keep their `tier:${tier}` tags; they never serve a new current request.
  if (!isWorkspaceCoworkCurrentProductTier(entryTier)) {
    const requiredTags = [
      `tier:${entryTier}`,
      ...(entryTier === "profi" && monitorOption
        ? workspaceProductMonitorOptionTableTags[monitorOption]
        : []),
    ];

    return hasAvailableWorkspaceTableCandidate(
      tables,
      requiredTags,
      occupancyByTableId,
      workspaceBookingSeatCount
    ).pipe(Effect.map((available) => !available));
  }

  return isCoworkOfferUnavailable(tables, occupancyByTableId, {
    entryTier,
    ...(monitorOption && { monitorOption }),
  });
};

/**
 * Availability uses the exact same shared candidate predicate as the
 * authoritative table assignment.
 */
const isCoworkOfferUnavailable = (
  tables: readonly DotyposTable[],
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>,
  query: WorkspaceCoworkTableCandidateQuery
) =>
  hasAvailableWorkspaceTableCandidateByPredicate(
    tables,
    (tableTags) => isWorkspaceCoworkTableCandidate(tableTags, query),
    occupancyByTableId,
    workspaceBookingSeatCount
  ).pipe(Effect.map((available) => !available));

/**
 * A cowork category is offered when ANY eligible table for it is available in
 * that offer's true interval. Open Space only has bare open-space tables;
 * Reserved Desk remains available while either a bare desk or any single
 * workstation configuration is available in the full Prague day.
 */
const isCoworkCategoryUnavailable = (
  tables: readonly DotyposTable[],
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>,
  entryTier: WorkspaceCoworkProductTier
) =>
  entryTier === "open-space"
    ? isCoworkOfferUnavailable(tables, occupancyByTableId, { entryTier })
    : Effect.map(
        Effect.all([
          isCoworkOfferUnavailable(tables, occupancyByTableId, { entryTier }),
          Effect.forEach(workspaceProductMonitorOptions, (monitorOption) =>
            isCoworkOfferUnavailable(tables, occupancyByTableId, {
              entryTier,
              monitorOption,
            })
          ),
        ]),
        ([bareUnavailable, monitorOptionsUnavailable]) =>
          bareUnavailable && monitorOptionsUnavailable.every(Boolean)
      );

const isMeetingRoomUnavailable = (
  tables: readonly DotyposTable[],
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>
) =>
  hasAvailableWorkspaceTableCandidate(
    tables,
    [workspaceMeetingRoomReservationTableTag],
    occupancyByTableId,
    workspaceBookingSeatCount,
    true
  ).pipe(Effect.map((available) => !available));

const isOfficeUnavailable = (
  tables: readonly DotyposTable[],
  occupancyByTableId: ReadonlyMap<DotyposTableId, number>,
  seats: number
) =>
  hasAvailableWorkspaceTableCandidate(
    tables,
    [workspaceOfficeReservationTableTag],
    occupancyByTableId,
    seats,
    true
  ).pipe(Effect.map((available) => !available));

const getDateRange = Effect.fn(function* (from: string, to: string) {
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
      cowork: ({ date, entryTier }) =>
        date
          ? normalizeCoworkAvailabilityInterval(date, entryTier)
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

const normalizeCoworkAvailabilityInterval = (
  date: string,
  entryTier?: WorkspaceCoworkProductTier
) =>
  normalizeReservationInterval(
    getCoworkReservationIntervalInput(entryTier, date)
  ).pipe(
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
