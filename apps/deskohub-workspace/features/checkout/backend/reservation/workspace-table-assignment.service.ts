import {
  type DotyposReadFailure,
  type DotyposReservationId,
  DotyposService,
  type DotyposTable,
  type DotyposTableId,
} from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Match, Option } from "effect";
import { workspaceStatementConcurrency } from "@/db/database.service";
import { workspaceProductMonitorOptionTableTags } from "@/features/checkout/product-catalog";
import { CoworkPassesReleaseGate } from "@/features/passes/backend/cowork-passes-release-gate";
import {
  getBookingsWithPassDayIntents,
  observePassDayInventory,
} from "@/features/passes/backend/pass-day-capacity-bookings";
import {
  findMovablePassDays,
  planPassDayMove,
} from "@/features/passes/backend/pass-day-move-plan";
import { PassDayMoves } from "@/features/passes/backend/unlimited-pass-day-moves";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type CoworkReservationDetails,
  getCoworkReservationIntervalInput,
} from "@/features/reservation/cowork-reservation";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import type { CoworkStay } from "@/features/reservation/cowork-stay";
import { getMeetingRoomOccupiedInterval } from "@/features/reservation/meeting-room-early-setup";
import type { MeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import {
  getOfficeReservationIntervalInput,
  type OfficeReservationDetails,
} from "@/features/reservation/office-reservation";
import {
  getTouchedWorkspaceDateBounds,
  getWorkspaceDate,
} from "@/features/reservation/reservation-date";
import {
  getReservationDate,
  getReservationIntervalNormalization,
  type ReservationInterval,
} from "@/features/reservation/reservation-interval";
import { ReservationIntervalValidationError } from "@/features/reservation/reservation-interval-domain";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { currentInstant } from "@/shared/utils/temporal";
import {
  excludeDotyposReservationsById,
  getOccupancyWindow,
  getOccupancyWindowDates,
  getTableBookingOccupancyById,
  type OccupancyWindow,
  type TableBooking,
  workspaceBookingSeatCount,
} from "./workspace-table-occupancy";
import {
  decodeTableCandidates,
  getWorkspaceTableCandidatesByPredicate,
  getWorkspaceTableSeatCapacity,
  hasCandidateCapacity,
  type InvalidDotyposTableSeats,
  isWorkspaceCoworkTableCandidate,
  selectWorkspaceTableFromCandidates,
  workspaceCoworkOpenSpaceTableTag,
  workspaceCoworkReservedDeskTableTag,
  workspaceMeetingRoomReservationTableTag,
  workspaceOfficeReservationTableTag,
} from "./workspace-table-selection";

type CoworkTableAssignmentReservation = StoredCoworkReservationDetails &
  Pick<CoworkReservationDetails, "date"> & {
    /** The booked Reserved Desk stay; absence is a day stay. */
    readonly stay?: CoworkStay;
  };

export type WorkspaceTableAssignmentReservation =
  | CoworkTableAssignmentReservation
  | MeetingRoomReservationDetails
  | OfficeReservationDetails;

type WorkspaceTableAssignment = {
  readonly requiredTags: readonly string[];
  readonly isCandidateTable: (tableTags: ReadonlySet<string>) => boolean;
  readonly scoreCoworkOpenSpaceCapacity?: true;
};

const getRequiredTagsAssignment = (
  requiredTags: readonly string[]
): WorkspaceTableAssignment => ({
  requiredTags,
  isCandidateTable: (tableTags: ReadonlySet<string>) =>
    requiredTags.every((tag) => tableTags.has(tag)),
});

/**
 * Meeting rooms and offices hold their table exclusively. Cowork bookings
 * share a table up to its seat capacity.
 */
const requiresEmptyTable = (kind: WorkspaceReservationKind) =>
  Match.value({ kind }).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => false,
      "meeting-room": () => true,
      office: () => true,
    })
  );

/**
 * Whether the table a Dotypos reservation holds is still free for it:
 * `unavailable` when other active bookings took the capacity its family
 * needs, or when the table is gone, disabled or hidden, or the booking names
 * no table, no increasing held span, or no readable seat count.
 */
type AssignedTableAvailability = "available" | "unavailable";

/**
 * The table hold a reservation asks for, whatever its status. Unlike the
 * occupancy of other bookings, nothing defaults: an unreadable fact is none.
 */
const getRequestedTableBooking = (
  reservation: ReservationRecord
): Option.Option<TableBooking> => {
  const booked = decodeBookedReservation(reservation);
  return Option.all({
    tableId: Option.fromNullishOr(reservation._tableId),
    interval: booked.occupiedInterval,
    seats: booked.seats,
  }).pipe(
    Option.map(({ tableId, interval, seats }) => ({
      tableId,
      startsAt: interval.startsAt.epochMilliseconds,
      endsAt: interval.endsAt.epochMilliseconds,
      seats,
    }))
  );
};

const getReservedDeskScoringOccupancyById = Effect.fn(
  "workspaceTableAssignment.getReservedDeskScoringOccupancyById"
)(function* (
  tables: readonly DotyposTable[],
  actualOccupancyByTableId: ReadonlyMap<DotyposTableId, number>
) {
  const rankingOccupancyByTableId = new Map(actualOccupancyByTableId);

  for (const table of tables) {
    if (
      table.enabled !== true ||
      table.display !== true ||
      !table.tags?.includes(workspaceCoworkOpenSpaceTableTag)
    ) {
      continue;
    }

    const seatCapacity = yield* getWorkspaceTableSeatCapacity(table);
    rankingOccupancyByTableId.set(
      table.id,
      Math.max(actualOccupancyByTableId.get(table.id) ?? 0, seatCapacity)
    );
  }

  return rankingOccupancyByTableId;
});

export const getWorkspaceReservationInterval = (
  reservation: WorkspaceTableAssignmentReservation
) =>
  getReservationIntervalNormalization(
    Match.value(reservation).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: ({ entryTier, date, stay }) =>
          getCoworkReservationIntervalInput(entryTier, date, stay),
        "meeting-room": getMeetingRoomOccupiedInterval,
        office: getOfficeReservationIntervalInput,
      })
    )
  );

/**
 * No active, visible Dotypos table carries the tags a reservation needs, so
 * Workspace's table configuration can't serve it at all.
 */
export class TableAssignmentUnconfigured extends Data.TaggedError(
  "TableAssignmentUnconfigured"
)<{
  readonly requiredTags: readonly string[];
  readonly message: string;
}> {}

/** Every matching table is already occupied for the reservation interval. */
export class TableAssignmentUnavailableError extends Data.TaggedError(
  "TableAssignmentUnavailableError"
)<{
  readonly requiredTags: readonly string[];
  readonly message: string;
}> {}

export interface IWorkspaceTableAssignmentService {
  readonly assignTableId: (
    reservation: WorkspaceTableAssignmentReservation,
    options?: { readonly allowPassDayMove: true }
  ) => Effect.Effect<
    DotyposTableId,
    | DotyposReadFailure
    | EffectDrizzleQueryError
    | InvalidDotyposTableSeats
    | ReservationIntervalValidationError
    | TableAssignmentUnavailableError
    | TableAssignmentUnconfigured
  >;
  /**
   * Checks the exact table, bounds, and seats a Dotypos reservation holds
   * against live Dotypos occupancy, whatever the reservation's own status;
   * the reservation itself never counts. Meeting-room bounds are the held
   * span, early setup included. Never assigns another table. Reads Dotypos,
   * so run it outside every database transaction.
   */
  readonly getAssignedTableAvailability: (input: {
    readonly reservation: ReservationRecord;
    readonly kind: WorkspaceReservationKind;
  }) => Effect.Effect<
    AssignedTableAvailability,
    DotyposReadFailure | EffectDrizzleQueryError | InvalidDotyposTableSeats
  >;
}

export class WorkspaceTableAssignmentService extends Context.Service<
  WorkspaceTableAssignmentService,
  IWorkspaceTableAssignmentService
>()("@deskohub-workspace/checkout/WorkspaceTableAssignmentService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const workspaceReservations = yield* WorkspaceReservationRepository;
      const moves = yield* Effect.serviceOption(PassDayMoves);
      const passGate = yield* Effect.serviceOption(CoworkPassesReleaseGate);

      const loadInventory = Effect.fn(
        "WorkspaceTableAssignmentService.loadInventory"
      )(function* (window: OccupancyWindow) {
        const dates = getTouchedWorkspaceDateBounds({
          startsAt: Temporal.Instant.fromEpochMilliseconds(window.startsAt),
          endsAt: Temporal.Instant.fromEpochMilliseconds(window.endsAt),
        });
        // Read local intents before provider reservations so an attaching
        // pass day remains visible on at least one side of the handover.
        const passDayIntents =
          yield* workspaceReservations.selectPendingPassDayCapacity(dates);
        const concurrency = yield* workspaceStatementConcurrency;
        const reads = yield* Effect.all(
          {
            tables: dotypos.getTables(),
            observations: observePassDayInventory(
              workspaceReservations,
              dotypos.listActiveReservationsOverlapping(
                getOccupancyWindowDates(window)
              ),
              passDayIntents
            ),
            expiredDotyposReservationIds: workspaceReservations
              .selectExpiredHoldDotyposReservationIds({
                now: Temporal.Now.instant(),
              })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning(
                    "Workspace table assignment expired hold filter failed",
                    { cause }
                  )
                ),
                Effect.orElseSucceed((): readonly DotyposReservationId[] => [])
              ),
          },
          { concurrency, mode: "result" }
        );
        const observations = yield* Effect.fromResult(reads.observations);
        return {
          ...observations,
          tables: yield* Effect.fromResult(reads.tables),
          expiredDotyposReservationIds: yield* Effect.fromResult(
            reads.expiredDotyposReservationIds
          ),
        };
      });

      const assignTableId = Effect.fn(
        "WorkspaceTableAssignmentService.assignTableId"
      )(
        (
          reservation: WorkspaceTableAssignmentReservation,
          options?: { readonly allowPassDayMove: true }
        ) =>
          Effect.succeed({ reservation }).pipe(
            Effect.let("assignment", ({ reservation }) =>
              getReservationAssignment(reservation)
            ),
            Effect.let("seats", ({ reservation }) =>
              getWorkspaceReservationSeats(reservation)
            ),
            Effect.tap(({ assignment }) =>
              Effect.logInfo("Workspace table assignment started", {
                requiredTags: assignment.requiredTags,
              })
            ),
            Effect.bind("occupancyWindow", ({ reservation }) =>
              Effect.map(
                getWorkspaceOccupiedInterval(reservation),
                getOccupancyWindow
              )
            ),
            Effect.bind("inventory", ({ occupancyWindow }) =>
              loadInventory(occupancyWindow)
            ),
            Effect.let("activeReservations", ({ inventory }) =>
              excludeDotyposReservationsById(
                inventory.reservations,
                inventory.expiredDotyposReservationIds
              )
            ),
            Effect.tap(({ inventory }) =>
              Effect.logInfo("Workspace table assignment inventory loaded", {
                reservationCount: inventory.reservations.length,
                tableCount: inventory.tables.length,
              })
            ),
            Effect.let(
              "occupancyByTableId",
              ({ activeReservations, occupancyWindow, inventory }) =>
                getTableBookingOccupancyById(
                  getBookingsWithPassDayIntents(
                    activeReservations,
                    inventory.passDayIntents
                  ),
                  occupancyWindow
                )
            ),
            Effect.bind(
              "rankingOccupancyByTableId",
              ({ assignment, inventory, occupancyByTableId }) =>
                assignment.scoreCoworkOpenSpaceCapacity
                  ? getReservedDeskScoringOccupancyById(
                      inventory.tables,
                      occupancyByTableId
                    )
                  : Effect.succeed(occupancyByTableId)
            ),
            Effect.tap(({ occupancyByTableId }) =>
              Effect.logDebug("Workspace table occupancy calculated", {
                occupancyByTableId: Object.fromEntries(occupancyByTableId),
              })
            ),
            Effect.let("matchingTables", ({ assignment, inventory }) =>
              getWorkspaceTableCandidatesByPredicate(
                inventory.tables,
                assignment.isCandidateTable
              )
            ),
            Effect.bind(
              "matchingTable",
              ({
                seats,
                inventory,
                matchingTables,
                occupancyByTableId,
                rankingOccupancyByTableId,
              }) =>
                selectWorkspaceTableFromCandidates(
                  matchingTables,
                  inventory.tables,
                  occupancyByTableId,
                  seats,
                  requiresEmptyTable(reservation.kind),
                  rankingOccupancyByTableId
                )
            ),
            Effect.bind(
              "availableTable",
              Effect.fnUntraced(function* ({
                assignment,
                matchingTable,
                matchingTables,
                inventory,
                occupancyWindow,
                seats,
              }) {
                if (
                  matchingTable ||
                  matchingTables.length === 0 ||
                  !options?.allowPassDayMove ||
                  Option.isNone(moves) ||
                  Option.isNone(passGate) ||
                  !inventory.passDayIntents.some(
                    ({ movableReservationId }) => movableReservationId
                  ) ||
                  !(yield* passGate.value.isOpen)
                )
                  return matchingTable;
                const { first, last } = getTouchedWorkspaceDateBounds({
                  startsAt: Temporal.Instant.fromEpochMilliseconds(
                    occupancyWindow.startsAt
                  ),
                  endsAt: Temporal.Instant.fromEpochMilliseconds(
                    occupancyWindow.endsAt
                  ),
                });
                // The replacement needs room for the whole pass day, even when
                // the ordinary booking touches only part of that day.
                const full = yield* loadInventory({
                  startsAt: getOccupancyWindow(first).startsAt,
                  endsAt: getOccupancyWindow(last).endsAt,
                });
                const active = excludeDotyposReservationsById(
                  full.reservations,
                  full.expiredDotyposReservationIds
                );
                const bookings = getBookingsWithPassDayIntents(
                  active,
                  full.passDayIntents
                );
                const candidates = yield* Effect.fromResult(
                  decodeTableCandidates(
                    getWorkspaceTableCandidatesByPredicate(
                      full.tables,
                      assignment.isCandidateTable
                    )
                  )
                );
                const move = planPassDayMove({
                  sources: findMovablePassDays(
                    active,
                    full.passDayIntents,
                    getWorkspaceDate(yield* currentInstant)
                  ),
                  bookings,
                  tables: full.tables,
                  candidates,
                  window: occupancyWindow,
                  occupancy: getTableBookingOccupancyById(
                    bookings,
                    occupancyWindow
                  ),
                  seats,
                  requireEmpty: requiresEmptyTable(reservation.kind),
                });
                if (
                  !move ||
                  !(yield* moves.value
                    .move(move)
                    .pipe(
                      Effect.catch(() =>
                        Effect.logWarning(
                          "Unlimited pass day move was not completed"
                        ).pipe(Effect.as(false))
                      )
                    ))
                )
                  return undefined;
                // Recheck before allocating. Dotypos can reopen the old
                // reservation independently of the Workspace capacity lock.
                const refreshed = yield* loadInventory(occupancyWindow);
                const remaining = excludeDotyposReservationsById(
                  refreshed.reservations,
                  refreshed.expiredDotyposReservationIds
                );
                return yield* selectWorkspaceTableFromCandidates(
                  getWorkspaceTableCandidatesByPredicate(
                    refreshed.tables,
                    assignment.isCandidateTable
                  ),
                  refreshed.tables,
                  getTableBookingOccupancyById(
                    getBookingsWithPassDayIntents(
                      remaining,
                      refreshed.passDayIntents
                    ),
                    occupancyWindow
                  ),
                  seats,
                  requiresEmptyTable(reservation.kind)
                );
              })
            ),
            Effect.bind("matchingTableId", ({ availableTable, ...state }) =>
              validateTableAssignment({
                ...state,
                matchingTable: availableTable,
              })
            ),
            Effect.tap(({ matchingTableId }) =>
              Effect.logDebug("Workspace table assigned", {
                matchingTableId,
              })
            ),
            Effect.map(({ matchingTableId }) => matchingTableId),
            Effect.scoped,
            Effect.annotateLogs(getReservationLogAnnotations(reservation))
          )
      );

      const getAssignedTableAvailability = Effect.fn(
        "WorkspaceTableAssignmentService.getAssignedTableAvailability"
      )(
        function* (input: {
          readonly reservation: ReservationRecord;
          readonly kind: WorkspaceReservationKind;
        }) {
          const booking = getRequestedTableBooking(input.reservation);
          if (Option.isNone(booking)) {
            yield* Effect.logWarning(
              "Workspace assigned table has no readable table hold"
            );
            return "unavailable" as const;
          }

          const inventory = yield* loadInventory(booking.value);
          const table = inventory.tables.find(
            ({ id, enabled, display }) =>
              id === booking.value.tableId &&
              enabled === true &&
              display === true
          );
          if (!table) {
            yield* Effect.logInfo(
              "Workspace assigned table is no longer an active visible table"
            );
            return "unavailable" as const;
          }

          const otherReservations = excludeDotyposReservationsById(
            inventory.reservations,
            input.reservation.id === undefined
              ? inventory.expiredDotyposReservationIds
              : [
                  ...inventory.expiredDotyposReservationIds,
                  input.reservation.id,
                ]
          );
          const occupancyByTableId = getTableBookingOccupancyById(
            getBookingsWithPassDayIntents(
              otherReservations,
              inventory.passDayIntents
            ),
            booking.value
          );
          const seatCapacity = yield* getWorkspaceTableSeatCapacity(table);
          const available = hasCandidateCapacity(
            [{ table, seatCapacity }],
            occupancyByTableId,
            booking.value.seats,
            requiresEmptyTable(input.kind)
          );
          yield* Effect.logInfo(
            "Workspace assigned table availability checked",
            {
              available,
              occupancy: occupancyByTableId.get(table.id) ?? 0,
              seatCapacity,
            }
          );
          return available ? ("available" as const) : ("unavailable" as const);
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              dotyposReservationId: input.reservation.id,
              tableId: input.reservation._tableId,
              reservationKind: input.kind,
            })
          )
      );

      return {
        assignTableId,
        getAssignedTableAvailability,
      } satisfies IWorkspaceTableAssignmentService;
    })
  );
}

const getReservationAssignment = (
  reservation: WorkspaceTableAssignmentReservation
): WorkspaceTableAssignment =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (coworkReservation) =>
        Match.value(coworkReservation).pipe(
          Match.discriminatorsExhaustive("entryTier")({
            "open-space": ({ entryTier }) => ({
              requiredTags: [workspaceCoworkOpenSpaceTableTag],
              isCandidateTable: (tableTags: ReadonlySet<string>) =>
                isWorkspaceCoworkTableCandidate(tableTags, { entryTier }),
            }),
            "reserved-desk": ({ entryTier, monitorOption }) => ({
              requiredTags: [workspaceCoworkReservedDeskTableTag],
              isCandidateTable: (tableTags: ReadonlySet<string>) =>
                isWorkspaceCoworkTableCandidate(tableTags, {
                  entryTier,
                  ...(monitorOption && { monitorOption }),
                }),
              scoreCoworkOpenSpaceCapacity: true as const,
            }),
            basic: ({ entryTier }) =>
              getRequiredTagsAssignment([`tier:${entryTier}`]),
            plus: ({ entryTier }) =>
              getRequiredTagsAssignment([`tier:${entryTier}`]),
            profi: ({ entryTier, monitorOption }) =>
              getRequiredTagsAssignment([
                `tier:${entryTier}`,
                ...workspaceProductMonitorOptionTableTags[monitorOption],
              ]),
          })
        ),
      "meeting-room": () =>
        getRequiredTagsAssignment([workspaceMeetingRoomReservationTableTag]),
      office: () =>
        getRequiredTagsAssignment([workspaceOfficeReservationTableTag]),
    })
  );

const getWorkspaceOccupiedInterval = (
  reservation: WorkspaceTableAssignmentReservation
): Effect.Effect<ReservationInterval, ReservationIntervalValidationError> =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      // Occupancy must use the tier's authoritative reservation interval
      // (Open Space Prague 00:00-17:00 exclusive, every other tier Prague
      // midnight to next midnight, an overnight Reserved Desk stay noon to
      // noon), not the whole calendar day.
      cowork: ({ entryTier, date, stay }) =>
        getReservationIntervalNormalization(
          getCoworkReservationIntervalInput(entryTier, date, stay)
        ).pipe(
          Effect.mapError(
            (cause) =>
              new ReservationIntervalValidationError({
                path: cause.path,
                message: `Workspace cowork reservation interval must be valid for date: ${date}`,
                cause,
              })
          )
        ),
      "meeting-room": (meetingRoomReservation) =>
        getReservationIntervalNormalization(
          getMeetingRoomOccupiedInterval(meetingRoomReservation)
        ),
      office: (officeReservation) =>
        getReservationIntervalNormalization(
          getOfficeReservationIntervalInput(officeReservation)
        ),
    })
  );

/** The seats a Workspace reservation books on its Dotypos table. */
export const getWorkspaceReservationSeats = (
  reservation: WorkspaceTableAssignmentReservation
): number =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => workspaceBookingSeatCount,
      "meeting-room": () => workspaceBookingSeatCount,
      office: ({ seats }) => seats,
    })
  );

const validateTableAssignment = (input: {
  readonly assignment: WorkspaceTableAssignment;
  readonly matchingTable: DotyposTable | undefined;
  readonly matchingTables: readonly DotyposTable[];
}) =>
  Effect.succeed(input).pipe(
    Effect.filterOrFail(
      ({ matchingTables }) => matchingTables.length > 0,
      ({ assignment }) =>
        new TableAssignmentUnconfigured({
          requiredTags: assignment.requiredTags,
          message: `No active visible Dotypos workspace table matches tags: ${assignment.requiredTags.join(
            ", "
          )}`,
        })
    ),
    Effect.let("matchingTableId", ({ matchingTable }) => matchingTable?.id),
    Effect.filterOrFail(
      (
        assignment
      ): assignment is typeof assignment & {
        readonly matchingTableId: DotyposTableId;
      } => assignment.matchingTableId !== undefined,
      ({ assignment }) =>
        new TableAssignmentUnavailableError({
          requiredTags: assignment.requiredTags,
          message: `No available Dotypos workspace table matches tags: ${assignment.requiredTags.join(
            ", "
          )}`,
        })
    ),
    Effect.map(({ matchingTableId }) => matchingTableId)
  );

const getReservationLogAnnotations = (
  reservation: WorkspaceTableAssignmentReservation
) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ coffee, date, entryTier, monitorOption }) => ({
        reservationKind: reservation.kind,
        entryTier,
        coffee,
        date,
        monitorOption,
      }),
      "meeting-room": (meetingRoomReservation) => ({
        reservationKind: meetingRoomReservation.kind,
        date: getReservationDate({
          interval: meetingRoomReservation,
          timeZone: workspaceSiteConstants.location.timeZone,
        }),
      }),
      office: (officeReservation) => ({
        reservationKind: officeReservation.kind,
        startsOn: officeReservation.startsOn,
        endsOn: officeReservation.endsOn,
        seats: officeReservation.seats,
      }),
    })
  );
