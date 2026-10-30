import type {
  DotyposReservationId,
  DotyposReservationInterval,
} from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Match, Option, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  excludeDotyposReservationsById,
  type InvalidDotyposTableSeats,
} from "@/features/checkout/backend/reservation";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import { getCoworkReservationIntervalInput } from "@/features/reservation/cowork-reservation";
import { getMeetingRoomOccupiedInterval } from "@/features/reservation/meeting-room-early-setup";
import { getMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import {
  getMeetingRoomDayLastServiceDate,
  getMeetingRoomDayStartTimes,
  type MeetingRoomStartTime,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  coworkReservationKind,
  meetingRoomReservationKind,
  officeReservationKind,
} from "@/features/reservation/reservation-kind";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  currentInstant,
  getPlainDatesBetween,
  plainDateStringSchema,
} from "@/shared/utils/temporal";
import {
  getReservationDate,
  normalizeReservationInterval,
  type ReservationInterval,
  type ReservationIntervalError,
  type ReservationIntervalInput,
} from "../reservation-interval";
import {
  isMeetingRoomAvailable,
  type MeetingRoomStartTimes,
  type MeetingRoomStartTimesQuery,
  type WorkspaceAvailability,
  type WorkspaceAvailabilityNotice,
  type WorkspaceAvailabilityQuery,
  type WorkspaceAvailabilityUnavailableTarget,
} from "../workspace-availability";
import {
  type AvailabilityEvaluationInput,
  evaluateAvailability,
} from "./availability-evaluation";
import {
  AdvisoryAvailabilityInventory,
  type AvailabilityInventory,
  type AvailabilityInventoryError,
  makeProviderInventory,
} from "./availability-inventory";
import { SharedAvailabilityInventoryLive } from "./availability-inventory-cache.server";
import {
  GoogleCalendarWorkspaceLimitationsService,
  type WorkspaceCalendarLimitation as WorkspaceCalendarLimitationType,
} from "./google-calendar-workspace-limitations.service";
import { WorkspaceReservationRepository } from "./workspace-reservation.repository";

/**
 * The caller asked for an impossible availability range, date, or interval.
 * The availability route answers it with 400.
 */
export class AvailabilityQueryInvalid extends Data.TaggedError(
  "AvailabilityQueryInvalid"
)<{ readonly message: string }> {}

/**
 * Why availability couldn't be computed: an invalid query, a provider read
 * failure, or a Dotypos table without a valid seat capacity.
 */
type AvailabilityError =
  | AvailabilityQueryInvalid
  | AvailabilityInventoryError
  | InvalidDotyposTableSeats;

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
  /**
   * Advisory availability for showing options. Tables, active reservations,
   * and calendar limitations may come from a shared snapshot that is up to a
   * few minutes old, so a booking must still pass `ensureAvailable`.
   */
  readonly getAvailability: (
    input: WorkspaceAvailabilityRequest
  ) => Effect.Effect<WorkspaceAvailability, AvailabilityError>;
  /**
   * Advisory free meeting-room starts on one date, each evaluated by the
   * single-interval rules against the shared-snapshot entries every single
   * check on that date loads, so listing a day after any check on it adds no
   * provider read.
   */
  readonly getMeetingRoomStartTimes: (
    input: MeetingRoomStartTimesRequest
  ) => Effect.Effect<MeetingRoomStartTimes, AvailabilityError>;
  /** Fails unless the reservation is available in live provider data. */
  readonly ensureAvailable: (
    query: WorkspaceAvailabilityEnsureQuery
  ) => Effect.Effect<void, AvailabilityError | WorkspaceTableUnavailableError>;
}

export type WorkspaceAvailabilityOccupancyExclusion = {
  readonly dotyposReservationId: DotyposReservationId;
};

type WorkspaceAvailabilityRequest = {
  readonly query: WorkspaceAvailabilityQuery;
  readonly occupancyExclusion?: WorkspaceAvailabilityOccupancyExclusion;
};

type MeetingRoomStartTimesRequest = {
  readonly query: MeetingRoomStartTimesQuery;
  readonly occupancyExclusion?: WorkspaceAvailabilityOccupancyExclusion;
};

const implementation = Effect.gen(function* () {
  const advisoryInventory = yield* AdvisoryAvailabilityInventory;
  const providerInventory = yield* makeProviderInventory;
  const workspaceReservations = yield* WorkspaceReservationRepository;

  const loadInventory = Effect.fn("workspaceAvailability.loadInventory")(
    function* (
      inventory: AvailabilityInventory,
      input: {
        /** The consecutive dates the inventory snapshot covers. */
        readonly dates: readonly Temporal.PlainDate[];
        readonly occupancyExclusion?: WorkspaceAvailabilityOccupancyExclusion;
      }
    ) {
      yield* Effect.logInfo("Workspace availability inventory load started");

      const [tables, reservations, limitations, expiredDotyposReservationIds] =
        yield* Effect.all(
          [
            inventory.tables,
            inventory.listActiveReservationsOverlapping(
              getDateRangeReservationInterval(input.dates)
            ),
            inventory.listLimitations({
              from: input.dates[0]!.toString(),
              to: input.dates.at(-1)!.toString(),
            }),
            loadExpiredHoldDotyposReservationIds(),
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

  const loadExpiredHoldDotyposReservationIds = Effect.fn(
    "workspaceAvailability.loadExpiredHoldDotyposReservationIds"
  )(
    function* () {
      yield* Effect.logInfo(
        "Workspace availability expired hold filter started"
      );

      const expiredDotyposReservationIds =
        yield* workspaceReservations.selectExpiredHoldDotyposReservationIds({
          now: Temporal.Now.instant(),
        });

      yield* Effect.annotateLogsScoped({
        expiredHoldCount: expiredDotyposReservationIds.length,
      });
      yield* Effect.logInfo(
        "Workspace availability expired hold filter completed"
      );
      return expiredDotyposReservationIds;
    },
    (effect) =>
      effect.pipe(
        Effect.scoped,
        Effect.tapError((cause) =>
          Effect.logWarning(
            "Workspace availability expired hold filter failed",
            { cause }
          )
        ),
        Effect.orElseSucceed((): readonly DotyposReservationId[] => [])
      )
  );

  const computeAvailability = Effect.fn(
    "workspaceAvailability.getAvailability"
  )(
    function* (
      inventory: AvailabilityInventory,
      input: WorkspaceAvailabilityRequest
    ) {
      const { query } = input;
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
      yield* Effect.annotateLogsScoped({ selectedDate });

      const { tables, reservations, limitations } = yield* loadInventory(
        inventory,
        {
          dates: getInventoryDates(query, dates),
          occupancyExclusion: input.occupancyExclusion,
        }
      );
      const evaluation = yield* Effect.fromResult(
        evaluateAvailability({
          query,
          dates: dates.map(plainDateToString),
          reservation,
          selectedDate,
          tables,
          reservations,
          fullyOccupiedDates: getFullyOccupiedCalendarDates(limitations),
        })
      );

      const result = {
        date: selectedDate,
        from: query.from,
        to: query.to,
        ...evaluation,
        notices: getCalendarNotices(limitations).filter(
          (notice) => notice.date >= query.from && notice.date <= query.to
        ),
      } satisfies WorkspaceAvailability;

      yield* Effect.annotateLogsScoped({ result });
      yield* Effect.logInfo("Workspace availability computed");

      return result;
    },
    (effect, _inventory, input) =>
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
      const availability = yield* computeAvailability(providerInventory, {
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

  const selectFreeMeetingRoomStartTimes = ({
    query,
    occupancyExclusion,
    candidates,
  }: MeetingRoomStartTimesRequest & {
    readonly candidates: ReadonlyArray<MeetingRoomStartTime>;
  }) =>
    Effect.succeed({
      dates: getMeetingRoomInventoryDates(Temporal.PlainDate.from(query.date)),
    }).pipe(
      Effect.bind("inventory", ({ dates }) =>
        loadInventory(advisoryInventory, { dates, occupancyExclusion })
      ),
      Effect.let("fullyOccupiedDates", ({ inventory }) =>
        getFullyOccupiedCalendarDates(inventory.limitations)
      ),
      Effect.flatMap(({ dates, inventory, fullyOccupiedDates }) => {
        const isMeetingRoomFree = (interval: ReservationInterval) =>
          Effect.fromResult(
            evaluateMeetingRoomInterval({
              interval,
              dates,
              tables: inventory.tables,
              reservations: inventory.reservations,
              fullyOccupiedDates,
            })
          );
        return Effect.filter(candidates, (candidate) =>
          isMeetingRoomFree(candidate.interval)
        ).pipe(
          Effect.flatMap((freeCandidates) =>
            Effect.forEach(freeCandidates, (candidate) =>
              isMeetingRoomFree(
                getMeetingRoomOccupiedInterval({
                  ...candidate.interval,
                  earlySetup: true,
                })
              ).pipe(
                Effect.map(
                  (earlySetupAvailable): FreeMeetingRoomStartTime => ({
                    ...candidate,
                    earlySetupAvailable,
                  })
                )
              )
            )
          )
        );
      }),
      // A day with no start left needs no inventory.
      Effect.when(Effect.succeed(candidates.length > 0)),
      Effect.map(Option.getOrElse((): FreeMeetingRoomStartTime[] => []))
    );

  const getMeetingRoomStartTimes = Effect.fn(
    "workspaceAvailability.getMeetingRoomStartTimes"
  )(
    (input: MeetingRoomStartTimesRequest) =>
      Effect.succeed(input).pipe(
        Effect.tap(({ query }) => Effect.annotateLogsScoped({ query })),
        Effect.tap(() =>
          Effect.logInfo("Meeting-room start times computation started")
        ),
        Effect.bind("now", () => currentInstant),
        Effect.let("candidates", ({ query, now }) =>
          getMeetingRoomDayStartTimes({
            date: query.date,
            duration: getMeetingRoomReservationDuration(query.duration),
            now,
          })
        ),
        Effect.bind("startTimes", selectFreeMeetingRoomStartTimes),
        Effect.map(
          ({ query, startTimes }): MeetingRoomStartTimes => ({
            date: query.date,
            duration: query.duration,
            startTimes: startTimes.map(
              ({ startDateTime, interval, earlySetupAvailable }) => ({
                startDateTime,
                ...interval,
                earlySetupAvailable,
              })
            ),
          })
        ),
        Effect.tap((result) => Effect.annotateLogsScoped({ result })),
        Effect.tap(() => Effect.logInfo("Meeting-room start times computed"))
      ),
    (effect) =>
      effect.pipe(
        Effect.scoped,
        Effect.tapError((cause) =>
          Effect.logError("Meeting-room start times computation failed", {
            cause,
          })
        )
      )
  );

  return {
    getAvailability: (input) => computeAvailability(advisoryInventory, input),
    getMeetingRoomStartTimes,
    ensureAvailable,
  } satisfies IWorkspaceAvailabilityService;
});

export class WorkspaceAvailabilityService extends Context.Service<
  WorkspaceAvailabilityService,
  IWorkspaceAvailabilityService
>()("@deskohub-workspace/reservation/WorkspaceAvailabilityService") {
  static Default = Layer.effect(this, implementation);

  /** Serves advisory availability from the shared inventory snapshot. */
  static Live = this.Default.pipe(
    Layer.provide(SharedAvailabilityInventoryLive),
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

/** A free start, and whether the room is also free for its setup time. */
type FreeMeetingRoomStartTime = MeetingRoomStartTime & {
  readonly earlySetupAvailable: boolean;
};

/**
 * Evaluates one meeting-room interval exactly as a single-interval check for
 * it would be, over the inventory dates the interval itself touches. A listed
 * start passes its booked interval; its setup check passes the occupied one.
 */
const evaluateMeetingRoomInterval = ({
  interval,
  dates,
  ...inventory
}: Pick<
  AvailabilityEvaluationInput,
  "tables" | "reservations" | "fullyOccupiedDates"
> & {
  readonly interval: ReservationInterval;
  readonly dates: readonly Temporal.PlainDate[];
}) => {
  const { from, to } = getAvailabilityTouchedDateRange(interval);
  return evaluateAvailability({
    ...inventory,
    query: { kind: meetingRoomReservationKind, from, to, ...interval },
    dates: dates
      .map(plainDateToString)
      .filter((touchedDate) => touchedDate >= from && touchedDate <= to),
    reservation: interval,
    selectedDate: from,
  }).pipe(Result.map(isMeetingRoomAvailable));
};

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

const getDateRange = Effect.fn(function* (from: string, to: string) {
  const start = yield* parsePlainDate(from);
  const end = yield* parsePlainDate(to);

  if (Temporal.PlainDate.compare(start, end) > 0) {
    return yield* new AvailabilityQueryInvalid({
      message: "Availability range start must be before range end",
    });
  }

  return getPlainDatesBetween(start, end);
});

/**
 * Every date a meeting-room booking starting on `date` can occupy, from the
 * previous date, which a midnight start's setup time reaches. All
 * meeting-room reads for a start date load inventory over these dates, so a
 * single check and the date's start-times list request the same shared
 * snapshot entries whatever their duration.
 */
const getMeetingRoomInventoryDates = (date: Temporal.PlainDate) =>
  getPlainDatesBetween(
    date.subtract({ days: 1 }),
    Temporal.PlainDate.from(
      getMeetingRoomDayLastServiceDate(
        plainDateStringSchema.make(date.toString())
      )
    )
  );

/**
 * Dates the inventory snapshot covers for a query: its own dates, extended for
 * a meeting room through every date a booking from its start date can occupy.
 */
const getInventoryDates = (
  query: WorkspaceAvailabilityQuery,
  dates: readonly Temporal.PlainDate[]
): readonly Temporal.PlainDate[] => {
  if (query.kind !== meetingRoomReservationKind) return dates;

  const meetingRoomDates = getMeetingRoomInventoryDates(dates[0]!);
  return meetingRoomDates.length > dates.length ? meetingRoomDates : dates;
};

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
      new AvailabilityQueryInvalid({
        message: `Availability date must be a valid YYYY-MM-DD date: ${date}`,
      }),
  });

const getAvailabilityReservation = (
  query: WorkspaceAvailabilityQuery
): Effect.Effect<ReservationInterval | undefined, AvailabilityQueryInvalid> =>
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
  new AvailabilityQueryInvalid({
    message: `Availability interval must be valid${context}.`,
  });

const plainDateToString = (date: Temporal.PlainDate) => date.toString();
