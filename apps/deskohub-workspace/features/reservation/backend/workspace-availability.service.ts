import type {
  DotyposReservation,
  DotyposReservationId,
  DotyposReservationInterval,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Match, Option, Result } from "effect";
import {
  WorkspaceDatabase,
  workspaceStatementConcurrency,
} from "@/db/database.service";
import {
  excludeDotyposReservationsById,
  type InvalidDotyposTableSeats,
} from "@/features/checkout/backend/reservation";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import {
  CoworkPassesReleaseGate,
  CoworkPassesReleaseGateForRun,
} from "@/features/passes/backend/cowork-passes-release-gate";
import {
  getBookingsWithPassDayIntents,
  observePassDayInventory,
} from "@/features/passes/backend/pass-day-capacity-bookings";
import { findMovablePassDays } from "@/features/passes/backend/pass-day-move-plan";
import {
  type CoworkReservationDetails,
  getCoworkReservationIntervalInput,
} from "@/features/reservation/cowork-reservation";
import {
  type CoworkStay,
  isOvernightCoworkStay,
} from "@/features/reservation/cowork-stay";
import { getMeetingRoomOccupiedInterval } from "@/features/reservation/meeting-room-early-setup";
import type { MeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDuration,
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDuration,
  meetingRoomReservationDurations,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  getMeetingRoomDayLastServiceDate,
  getMeetingRoomDayStartTimes,
  type MeetingRoomStartTime,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  getOfficeReservationIntervalInput,
  type OfficeReservationDetails,
} from "@/features/reservation/office-reservation";
import { getWorkspaceDate } from "@/features/reservation/reservation-date";
import type { ReservationIntervalValidationError } from "@/features/reservation/reservation-interval-domain";
import { normalizeReservationIntervalFields } from "@/features/reservation/reservation-interval-normalization";
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
  type PlainDate,
  plainDateStringSchema,
} from "@/shared/utils/temporal";
import {
  getReservationDate,
  getReservationDateBounds,
  normalizeReservationInterval,
  type ReservationInterval,
  type ReservationIntervalError,
  type ReservationIntervalInput,
} from "../reservation-interval";
import {
  getWorkspaceAvailabilityRange,
  type MeetingRoomStartTimes,
  type MeetingRoomStartTimesQuery,
  type MeetingRoomUnavailableDates,
  type MeetingRoomUnavailableDatesQuery,
  type WorkspaceAvailability,
  type WorkspaceAvailabilityNotice,
  type WorkspaceAvailabilityQuery,
  type WorkspaceAvailabilityUnavailableTarget,
} from "../workspace-availability";
import {
  createMeetingRoomIntervalEvaluator,
  evaluateAvailability,
  type MeetingRoomIntervalEvaluator,
} from "./availability-evaluation";
import {
  AdvisoryAvailabilityInventory,
  type AvailabilityInventory,
  type AvailabilityInventoryError,
  getFullyOccupiedCalendarDates,
  makeProviderInventory,
} from "./availability-inventory";
import { SharedAvailabilityInventoryLive } from "./availability-inventory-cache.server";
import {
  GoogleCalendarWorkspaceLimitationsService,
  type WorkspaceCalendarLimitation as WorkspaceCalendarLimitationType,
} from "./google-calendar-workspace-limitations.service";
import type { ReservationRecord } from "./reservation-record";
import { WorkspaceReservationRepository } from "./workspace-reservation.repository";

/**
 * The caller asked for an impossible availability range, date, or interval.
 * The availability route answers it with 400.
 */
export class AvailabilityQueryInvalid extends Data.TaggedError(
  "AvailabilityQueryInvalid"
)<{ readonly message: string }> {}

/**
 * Why availability couldn't be computed: an invalid query, an inventory
 * read failure, or a Dotypos table without a valid seat capacity.
 */
type AvailabilityError =
  | AvailabilityQueryInvalid
  | AvailabilityInventoryError
  | EffectDrizzleQueryError
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
> & { readonly date: string; readonly stay?: CoworkStay };

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

/** The facts of a reservation, of any family, that decide its availability. */
export type AvailabilityReservation =
  | (Pick<
      CoworkReservationDetails,
      "kind" | "date" | "entryTier" | "monitorOption"
    > & {
      /** The booked Reserved Desk stay; absence is a day stay. */
      readonly stay?: CoworkStay;
    })
  | Pick<
      MeetingRoomReservationDetails,
      "kind" | "startsAt" | "endsAt" | "earlySetup"
    >
  | Pick<OfficeReservationDetails, "kind" | "startsOn" | "endsOn" | "seats">;

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
   * Advisory meeting-room starts on one date, free and taken, each evaluated
   * by the single-interval rules against the shared-snapshot entries every
   * single check on that date loads, so listing a day after any check on it
   * adds no provider read.
   */
  readonly getMeetingRoomStartTimes: (
    input: MeetingRoomStartTimesRequest
  ) => Effect.Effect<MeetingRoomStartTimes, AvailabilityError>;
  /**
   * Advisory meeting-room calendar: for each purchasable length the dates
   * without a free start of it, by the rules start times list them, from one
   * inventory snapshot over the range. A range longer than the six-month
   * calendar is invalid.
   */
  readonly getMeetingRoomUnavailableDates: (
    input: MeetingRoomUnavailableDatesRequest
  ) => Effect.Effect<MeetingRoomUnavailableDates, AvailabilityError>;
  /**
   * Fails unless the reservation is available in live provider data. A
   * meeting room needs its occupied interval, including any early setup; an
   * office needs every Prague day it spans.
   */
  readonly ensureAvailable: (
    reservation: AvailabilityReservation,
    options?: { readonly allowPassDayMove: true }
  ) => Effect.Effect<
    void,
    | AvailabilityError
    | WorkspaceTableUnavailableError
    | ReservationIntervalValidationError
  >;
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

type MeetingRoomUnavailableDatesRequest = {
  readonly query: MeetingRoomUnavailableDatesQuery;
  readonly occupancyExclusion?: WorkspaceAvailabilityOccupancyExclusion;
};

const implementation = Effect.gen(function* () {
  const advisoryInventory = yield* AdvisoryAvailabilityInventory;
  const providerInventory = yield* makeProviderInventory;
  const workspaceReservations = yield* WorkspaceReservationRepository;
  const passGate = yield* Effect.serviceOption(CoworkPassesReleaseGate);

  const loadInventory = Effect.fn("workspaceAvailability.loadInventory")(
    function* (
      inventory: AvailabilityInventory,
      input: {
        /** The consecutive dates the inventory snapshot covers. */
        readonly dates: readonly Temporal.PlainDate[];
        readonly occupancyExclusion?: WorkspaceAvailabilityOccupancyExclusion;
        readonly allowPassDayMove?: boolean;
      }
    ) {
      yield* Effect.logInfo("Workspace availability inventory load started");
      const first = input.dates[0]!;
      const last = input.dates.at(-1)!;
      // The provider can list a hold as soon as it is attached. Read its
      // local intent first so it is visible on at least one side of the handover.
      const passDayIntents =
        yield* workspaceReservations.selectPendingPassDayCapacity({
          first,
          last,
        });
      // The shared snapshot omits notes and customer links. A live read is
      // needed to match these intents to provider holds without counting both.
      const reservationInventory =
        passDayIntents.length > 0 ? providerInventory : inventory;
      const readReservations: Effect.Effect<
        readonly (DotyposReservation | ReservationRecord)[],
        AvailabilityInventoryError
      > = reservationInventory.listActiveReservationsOverlapping(
        getDateRangeReservationInterval(input.dates)
      );

      const [tablesRead, observationsRead, limitationsRead, expiredIdsRead] =
        yield* Effect.flatMap(workspaceStatementConcurrency, (concurrency) =>
          Effect.all(
            [
              inventory.tables,
              observePassDayInventory(
                workspaceReservations,
                readReservations,
                passDayIntents
              ),
              inventory.listLimitations({
                from: first.toString(),
                to: last.toString(),
              }),
              loadExpiredHoldDotyposReservationIds(),
            ],
            { concurrency, mode: "result" }
          )
        );
      const observations = yield* Effect.fromResult(observationsRead);
      const tables = yield* Effect.fromResult(tablesRead);
      const limitations = yield* Effect.fromResult(limitationsRead);
      const expiredDotyposReservationIds =
        yield* Effect.fromResult(expiredIdsRead);
      const { reservations } = observations;
      const replacementReservationId =
        input.occupancyExclusion?.dotyposReservationId;
      const replacementIsPending = reservations.some(
        (reservation) =>
          reservation.id === replacementReservationId &&
          reservation.status === "NEW"
      );
      const activeReservations = excludeDotyposReservationsById<
        DotyposReservation | ReservationRecord
      >(reservations, [
        ...expiredDotyposReservationIds,
        ...(replacementIsPending && replacementReservationId
          ? [replacementReservationId]
          : []),
      ]);
      const movablePassDays =
        input.allowPassDayMove &&
        observations.passDayIntents.some(
          ({ movableReservationId }) => movableReservationId
        ) &&
        Option.isSome(passGate) &&
        (yield* passGate.value.isOpen)
          ? findMovablePassDays(
              activeReservations,
              observations.passDayIntents,
              getWorkspaceDate(yield* currentInstant)
            )
          : [];
      // Counts, not the records: whole inventories made each row tens of KB.
      yield* Effect.logInfo(
        "Workspace availability inventory load completed"
      ).pipe(
        Effect.annotateLogs({
          activeReservationCount: activeReservations.length,
          dateCount: input.dates.length,
          limitationCount: limitations.length,
          reservationCount: reservations.length,
          tableCount: tables.length,
        })
      );

      return {
        tables,
        bookings: getBookingsWithPassDayIntents(
          activeReservations,
          observations.passDayIntents
        ),
        limitations,
        movablePassDays,
      };
    },
    (effect) =>
      effect.pipe(
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
      input: WorkspaceAvailabilityRequest,
      allowPassDayMove: boolean
    ) {
      const { query } = input;
      yield* Effect.annotateLogsScoped(query);
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

      const { tables, bookings, limitations, movablePassDays } =
        yield* loadInventory(inventory, {
          dates: getInventoryDates(query, dates),
          occupancyExclusion: input.occupancyExclusion,
          allowPassDayMove,
        });
      const evaluation = yield* Effect.fromResult(
        evaluateAvailability({
          query,
          dates: dates.map(plainDateToString),
          reservation,
          selectedDate,
          tables,
          bookings,
          movablePassDays,
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

      yield* Effect.annotateLogsScoped(availabilityLogFields(result));
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
    function* (
      reservation: AvailabilityReservation,
      options?: { readonly allowPassDayMove: true }
    ) {
      const query = yield* getAvailabilityEnsureQuery(reservation);
      yield* Effect.annotateLogsScoped(query);
      yield* Effect.logInfo("Workspace availability assurance started");

      const reservationInterval = yield* Match.value(query).pipe(
        Match.discriminatorsExhaustive("kind")({
          "meeting-room": ({ startsAt, endsAt }) =>
            normalizeMeetingRoomAvailabilityInterval({ startsAt, endsAt }),
          cowork: ({ date, entryTier, stay }) =>
            normalizeCoworkAvailabilityInterval(date, entryTier, stay),
          office: ({ startsAt, endsAt }) =>
            normalizeMeetingRoomAvailabilityInterval({ startsAt, endsAt }),
        })
      );
      // A cowork query's dates are arrival dates, so an overnight stay checks
      // its arrival date alone; its inventory still covers the next date.
      const availabilityRange =
        query.kind === coworkReservationKind
          ? { from: query.date, to: query.date }
          : getAvailabilityTouchedDateRange(reservationInterval);
      const availability = yield* computeAvailability(
        providerInventory,
        {
          query: {
            ...query,
            from: availabilityRange.from,
            to: availabilityRange.to,
          },
        },
        options?.allowPassDayMove === true
      );
      yield* Effect.annotateLogsScoped(availabilityLogFields(availability));

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

  /**
   * Loads the meeting-room inventory over `dates` and evaluates intervals
   * against it, one shared view per request.
   */
  const loadMeetingRoomIntervalEvaluator = (input: {
    readonly dates: readonly Temporal.PlainDate[];
    readonly occupancyExclusion?: WorkspaceAvailabilityOccupancyExclusion;
  }) =>
    loadInventory(advisoryInventory, { ...input, allowPassDayMove: true }).pipe(
      Effect.map(({ tables, bookings, limitations, movablePassDays }) =>
        createMeetingRoomIntervalEvaluator({
          tables,
          bookings,
          movablePassDays,
          fullyOccupiedDates: getFullyOccupiedCalendarDates(limitations),
        })
      )
    );

  const partitionMeetingRoomStartTimes = ({
    query,
    occupancyExclusion,
    candidates,
  }: MeetingRoomStartTimesRequest & {
    readonly candidates: ReadonlyArray<MeetingRoomStartTime>;
  }) =>
    loadMeetingRoomIntervalEvaluator({
      dates: getMeetingRoomInventoryDates(Temporal.PlainDate.from(query.date)),
      occupancyExclusion,
    }).pipe(
      Effect.flatMap((evaluate) =>
        Effect.fromResult(partitionStartTimes(candidates, evaluate))
      ),
      // A day with no start left needs no inventory.
      Effect.when(Effect.succeed(candidates.length > 0)),
      Effect.map(Option.getOrElse(() => noStartTimes))
    );

  const getMeetingRoomStartTimes = Effect.fn(
    "workspaceAvailability.getMeetingRoomStartTimes"
  )(
    (input: MeetingRoomStartTimesRequest) =>
      Effect.succeed(input).pipe(
        Effect.tap(({ query }) => Effect.annotateLogsScoped(query)),
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
        Effect.bind("startTimes", partitionMeetingRoomStartTimes),
        Effect.map(
          ({ query, startTimes }): MeetingRoomStartTimes => ({
            date: query.date,
            duration: query.duration,
            startTimes: startTimes.free.map(
              ({ startDateTime, interval, earlySetupAvailable }) => ({
                startDateTime,
                ...interval,
                earlySetupAvailable,
              })
            ),
            unavailableStartTimes: startTimes.taken.map(
              ({ startDateTime, interval }) => ({ startDateTime, ...interval })
            ),
          })
        ),
        Effect.tap((result) =>
          Effect.annotateLogsScoped({
            startTimeCount: result.startTimes.length,
            unavailableStartTimeCount: result.unavailableStartTimes.length,
          })
        ),
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

  const getMeetingRoomUnavailableDates = Effect.fn(
    "workspaceAvailability.getMeetingRoomUnavailableDates"
  )(
    function* ({
      query,
      occupancyExclusion,
    }: MeetingRoomUnavailableDatesRequest) {
      yield* Effect.annotateLogsScoped(query);
      yield* Effect.logInfo(
        "Meeting-room unavailable dates computation started"
      );

      const dates = yield* getCalendarDateRange(query);
      const now = yield* currentInstant;
      const evaluate = yield* loadMeetingRoomIntervalEvaluator({
        dates: getMeetingRoomInventoryDates(dates[0]!, dates.at(-1)),
        occupancyExclusion,
      });
      const durations = yield* Effect.fromResult(
        findUnavailableDatesByDuration({
          dates: dates.map((date) =>
            plainDateStringSchema.make(date.toString())
          ),
          now,
          evaluate,
        })
      );
      const unavailableDates = durations.reduce<readonly PlainDate[]>(
        (unavailableForEveryLength, duration) =>
          unavailableForEveryLength.filter((date) =>
            duration.unavailableDates.includes(date)
          ),
        durations[0]?.unavailableDates ?? []
      );

      yield* Effect.annotateLogsScoped({
        unavailableDateCount: unavailableDates.length,
      });
      yield* Effect.logInfo("Meeting-room unavailable dates computed");

      const calendar: MeetingRoomUnavailableDates = {
        from: plainDateStringSchema.make(dates[0]!.toString()),
        to: plainDateStringSchema.make(dates.at(-1)!.toString()),
        unavailableDates,
        durations,
      };
      return calendar;
    },
    (effect) =>
      effect.pipe(
        Effect.scoped,
        Effect.tapError((cause) =>
          Effect.logError("Meeting-room unavailable dates computation failed", {
            cause,
          })
        )
      )
  );

  return {
    getAvailability: (input) =>
      computeAvailability(advisoryInventory, input, true),
    getMeetingRoomStartTimes,
    getMeetingRoomUnavailableDates,
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
    Layer.provide(CoworkPassesReleaseGateForRun),
    Layer.provide(
      WorkspaceReservationRepository.Default.pipe(
        Layer.provide(WorkspaceDatabase.Default)
      )
    )
  );
}

/** The occupancy query that decides whether a reservation is available. */
const getAvailabilityEnsureQuery = (reservation: AvailabilityReservation) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork) =>
        Effect.succeed<WorkspaceAvailabilityEnsureQuery>({
          kind: cowork.kind,
          date: cowork.date,
          entryTier: cowork.entryTier,
          monitorOption: cowork.monitorOption,
          ...(cowork.stay && { stay: cowork.stay }),
        }),
      "meeting-room": (meetingRoom) =>
        Effect.succeed<WorkspaceAvailabilityEnsureQuery>({
          kind: meetingRoom.kind,
          ...getMeetingRoomOccupiedInterval(meetingRoom),
        }),
      office: (office) =>
        normalizeReservationIntervalFields(
          getOfficeReservationIntervalInput(office),
          workspaceSiteConstants.location.timeZone
        ).pipe(
          Effect.map(
            (interval): WorkspaceAvailabilityEnsureQuery => ({
              kind: office.kind,
              ...interval,
              seats: office.seats,
            })
          )
        ),
    })
  );

/**
 * Availability for log annotations: counts for its lists, since the date
 * lists span up to the whole queried range, and its flags as they are.
 */
const availabilityLogFields = (availability: WorkspaceAvailability) => ({
  unavailableDateCount: availability.unavailableDates.length,
  reservedDeskWorkstationRequiredDateCount:
    availability.reservedDeskWorkstationRequiredDates.length,
  unavailableCoworkTierCount: availability.unavailableCoworkTiers.length,
  unavailableMonitorOptionCount: availability.unavailableMonitorOptions.length,
  meetingRoomUnavailable: availability.meetingRoomUnavailable,
  officeUnavailable: availability.officeUnavailable,
  noticeCount: availability.notices.length,
});

/** A free start, and whether the room is also free for its setup time. */
type FreeMeetingRoomStartTime = MeetingRoomStartTime & {
  readonly earlySetupAvailable: boolean;
};

/** Every start of a day, split into free and taken, in chronological order. */
type PartitionedStartTimes = {
  readonly free: ReadonlyArray<FreeMeetingRoomStartTime>;
  readonly taken: ReadonlyArray<MeetingRoomStartTime>;
};

const noStartTimes: PartitionedStartTimes = { free: [], taken: [] };

/**
 * Evaluates one meeting-room interval exactly as a single-interval check for
 * it would be, over the Prague dates the interval itself touches. A listed
 * start passes its booked interval; its setup check passes the occupied one.
 */
const isMeetingRoomFree = (
  evaluate: MeetingRoomIntervalEvaluator,
  interval: ReservationInterval
) => evaluate(interval, getAvailabilityTouchedDateRange(interval));

const partitionStartTimes = (
  candidates: ReadonlyArray<MeetingRoomStartTime>,
  evaluate: MeetingRoomIntervalEvaluator
) =>
  Result.gen(function* () {
    const free: FreeMeetingRoomStartTime[] = [];
    const taken: MeetingRoomStartTime[] = [];
    for (const candidate of candidates) {
      if (!(yield* isMeetingRoomFree(evaluate, candidate.interval))) {
        taken.push(candidate);
        continue;
      }
      const earlySetupAvailable = yield* isMeetingRoomFree(
        evaluate,
        getMeetingRoomOccupiedInterval({
          ...candidate.interval,
          earlySetup: true,
        })
      );
      free.push({ ...candidate, earlySetupAvailable });
    }
    return { free, taken } satisfies PartitionedStartTimes;
  });

/**
 * For each purchasable length, the dates on which no start the form accepts
 * is free. A date stops being checked at its first free start.
 */
const findUnavailableDatesByDuration = ({
  dates,
  now,
  evaluate,
}: {
  readonly dates: readonly PlainDate[];
  readonly now: Temporal.Instant;
  readonly evaluate: MeetingRoomIntervalEvaluator;
}) =>
  Result.gen(function* () {
    const hasFreeStart = function* (
      date: PlainDate,
      duration: MeetingRoomReservationDuration
    ) {
      for (const { interval } of getMeetingRoomDayStartTimes({
        date,
        duration,
        now,
      })) {
        if (yield* isMeetingRoomFree(evaluate, interval)) return true;
      }
      return false;
    };

    const durations: Array<MeetingRoomUnavailableDates["durations"][number]> =
      [];
    for (const duration of meetingRoomReservationDurations) {
      const unavailableDates: PlainDate[] = [];
      for (const date of dates) {
        if (!(yield* hasFreeStart(date, duration))) unavailableDates.push(date);
      }
      durations.push({
        duration: getMeetingRoomReservationDurationKey(duration),
        unavailableDates,
      });
    }
    return durations;
  });

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

/** A calendar's dates, which span at most the six-month calendar range. */
const getCalendarDateRange = Effect.fn(function* ({
  from,
  to,
}: MeetingRoomUnavailableDatesQuery) {
  // Checked before the range's dates are listed, so a long range costs none.
  const start = yield* parsePlainDate(from);
  const end = yield* parsePlainDate(to);
  const calendarEnd = getWorkspaceAvailabilityRange(start.toString()).to;
  if (Temporal.PlainDate.compare(end, calendarEnd) > 0) {
    return yield* new AvailabilityQueryInvalid({
      message: "Availability range must not exceed the calendar range",
    });
  }
  return yield* getDateRange(from, to);
});

/**
 * Every date a meeting-room booking starting from `first` through `last` can
 * occupy, from the date before `first`, which a midnight start's setup time
 * reaches. All meeting-room reads for a start date load inventory over these
 * dates, so a single check and the date's start-times list request the same
 * shared snapshot entries whatever their duration.
 */
const getMeetingRoomInventoryDates = (
  first: Temporal.PlainDate,
  last = first
) =>
  getPlainDatesBetween(
    first.subtract({ days: 1 }),
    Temporal.PlainDate.from(
      getMeetingRoomDayLastServiceDate(
        plainDateStringSchema.make(last.toString())
      )
    )
  );

/**
 * Dates the inventory snapshot covers for a query: its own dates, extended for
 * a meeting room through every date a booking from its start date can occupy,
 * and for an overnight cowork stay through the date after its last arrival.
 */
const getInventoryDates = (
  query: WorkspaceAvailabilityQuery,
  dates: readonly Temporal.PlainDate[]
): readonly Temporal.PlainDate[] => {
  if (query.kind === coworkReservationKind) {
    return isOvernightCoworkStay(query.entryTier, query.stay)
      ? [...dates, dates.at(-1)!.add({ days: 1 })]
      : dates;
  }
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
      cowork: ({ date, entryTier, stay }) =>
        date
          ? normalizeCoworkAvailabilityInterval(date, entryTier, stay)
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
  entryTier?: WorkspaceCoworkProductTier,
  stay?: CoworkStay
) =>
  normalizeReservationInterval(
    getCoworkReservationIntervalInput(entryTier, date, stay)
  ).pipe(
    Effect.mapError((error) =>
      toAvailabilityIntervalError(error, ` for date: ${date}`)
    )
  );

const getAvailabilityTouchedDateRange = (input: ReservationInterval) => {
  const { first, last } = getReservationDateBounds(input);
  return { from: first.toString(), to: last.toString() };
};

const toAvailabilityIntervalError = (
  _error: ReservationIntervalError,
  context = ""
) =>
  new AvailabilityQueryInvalid({
    message: `Availability interval must be valid${context}.`,
  });

const plainDateToString = (date: Temporal.PlainDate) => date.toString();
