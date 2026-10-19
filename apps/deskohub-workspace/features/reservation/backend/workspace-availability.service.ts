import {
  type DotyposReservationId,
  type DotyposReservationInterval,
  ValidationError,
} from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Match } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { excludeDotyposReservationsById } from "@/features/checkout/backend/reservation";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import { getCoworkReservationIntervalInput } from "@/features/reservation/cowork-reservation";
import {
  coworkReservationKind,
  meetingRoomReservationKind,
  officeReservationKind,
} from "@/features/reservation/reservation-kind";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { getPlainDatesBetween } from "@/shared/utils/temporal";
import {
  getReservationDate,
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
import { evaluateAvailability } from "./availability-evaluation";
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
  ) => Effect.Effect<WorkspaceAvailability, AvailabilityInventoryError>;
  /** Fails unless the reservation is available in live provider data. */
  readonly ensureAvailable: (
    query: WorkspaceAvailabilityEnsureQuery
  ) => Effect.Effect<
    void,
    AvailabilityInventoryError | WorkspaceTableUnavailableError
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
  const advisoryInventory = yield* AdvisoryAvailabilityInventory;
  const providerInventory = yield* makeProviderInventory;
  const workspaceReservations = yield* WorkspaceReservationRepository;

  const loadInventory = Effect.fn("workspaceAvailability.loadInventory")(
    function* (
      inventory: AvailabilityInventory,
      input: WorkspaceAvailabilityRequest & {
        readonly reservationInterval: DotyposReservationInterval;
      }
    ) {
      yield* Effect.logInfo("Workspace availability inventory load started");

      const [tables, reservations, limitations, expiredDotyposReservationIds] =
        yield* Effect.all(
          [
            inventory.tables,
            inventory.listActiveReservationsOverlapping(
              input.reservationInterval
            ),
            inventory.listLimitations({
              from: input.query.from,
              to: input.query.to,
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
      const reservationInterval = getDateRangeReservationInterval(dates);
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
        { ...input, reservationInterval }
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
        notices: getCalendarNotices(limitations),
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

  return {
    getAvailability: (input) => computeAvailability(advisoryInventory, input),
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
    return yield* new ValidationError({
      message: "Availability range start must be before range end",
    });
  }

  return getPlainDatesBetween(start, end);
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
