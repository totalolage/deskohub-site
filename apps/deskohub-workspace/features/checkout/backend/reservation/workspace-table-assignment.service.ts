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
import type { Table } from "@deskohub/dotypos/generated";
import { Context, Data, Effect, Layer, Match } from "effect";
import { workspaceProductMonitorOptionTableTags } from "@/features/checkout/product-catalog";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type CoworkReservationDetails,
  getCoworkReservationIntervalInput,
} from "@/features/reservation/cowork-reservation";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import type { MeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import {
  getOfficeReservationIntervalInput,
  type OfficeReservationDetails,
} from "@/features/reservation/office-reservation";
import {
  getReservationDate,
  getReservationIntervalNormalization,
  type ReservationInterval,
} from "@/features/reservation/reservation-interval";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { getAssignableDotyposTableId } from "./dotypos-table-id";
import {
  excludeDotyposReservationsById,
  getWorkspaceReservationIntervalDates,
  getWorkspaceTableOccupancyById,
  workspaceBookingSeatCount,
} from "./workspace-table-occupancy";
import {
  getWorkspaceTableCandidatesByPredicate,
  getWorkspaceTableSeatCapacity,
  isWorkspaceCoworkTableCandidate,
  selectWorkspaceTableFromCandidates,
  workspaceCoworkOpenSpaceTableTag,
  workspaceCoworkReservedDeskTableTag,
  workspaceMeetingRoomReservationTableTag,
  workspaceOfficeReservationTableTag,
} from "./workspace-table-selection";

type CoworkTableAssignmentReservation = StoredCoworkReservationDetails &
  Pick<CoworkReservationDetails, "date">;

export type WorkspaceTableAssignmentReservation =
  | CoworkTableAssignmentReservation
  | MeetingRoomReservationDetails
  | OfficeReservationDetails;

export type WorkspaceTableAssignment = {
  readonly requiredTags: readonly string[];
  readonly isCandidateTable: (tableTags: ReadonlySet<string>) => boolean;
  readonly requireEmptyTable: boolean;
  readonly scoreCoworkOpenSpaceCapacity?: true;
};

const getRequiredTagsAssignment = (
  requiredTags: readonly string[],
  requireEmptyTable: boolean
): WorkspaceTableAssignment => ({
  requiredTags,
  isCandidateTable: (tableTags: ReadonlySet<string>) =>
    requiredTags.every((tag) => tableTags.has(tag)),
  requireEmptyTable,
});

const getReservedDeskScoringOccupancyById = Effect.fn(
  "workspaceTableAssignment.getReservedDeskScoringOccupancyById"
)(function* (
  tables: readonly DotyposTable[],
  actualOccupancyByTableId: ReadonlyMap<DotyposTableId, number>
) {
  const rankingOccupancyByTableId = new Map(actualOccupancyByTableId);

  for (const table of tables) {
    const tableId = getAssignableDotyposTableId(table);
    if (
      !tableId ||
      table.enabled !== true ||
      table.display !== true ||
      !table.tags?.includes(workspaceCoworkOpenSpaceTableTag)
    ) {
      continue;
    }

    const seatCapacity = yield* getWorkspaceTableSeatCapacity(table);
    rankingOccupancyByTableId.set(
      tableId,
      Math.max(actualOccupancyByTableId.get(tableId) ?? 0, seatCapacity)
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
        cowork: ({ entryTier, date }) =>
          getCoworkReservationIntervalInput(entryTier, date),
        "meeting-room": (meetingRoom) => meetingRoom,
        office: getOfficeReservationIntervalInput,
      })
    )
  );

/** Every matching table is already occupied for the reservation interval. */
export class TableAssignmentUnavailableError extends Data.TaggedError(
  "TableAssignmentUnavailableError"
)<{
  readonly requiredTags: readonly string[];
  readonly message: string;
}> {}

export interface IWorkspaceTableAssignmentService {
  readonly assignTableId: (
    reservation: WorkspaceTableAssignmentReservation
  ) => Effect.Effect<
    DotyposTableId,
    | ExternalAPIError
    | NetworkError
    | TableAssignmentUnavailableError
    | ValidationError
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

      const loadInventory = Effect.fn(
        "WorkspaceTableAssignmentService.loadInventory"
      )((reservationInterval: DotyposReservationInterval) =>
        Effect.all(
          {
            tables: dotypos.getTables(),
            reservations:
              dotypos.listActiveReservationsOverlapping(reservationInterval),
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
          { concurrency: "inherit" }
        )
      );

      const assignTableId = Effect.fn(
        "WorkspaceTableAssignmentService.assignTableId"
      )((reservation: WorkspaceTableAssignmentReservation) =>
        Effect.succeed({ reservation }).pipe(
          Effect.let("assignment", ({ reservation }) =>
            getReservationAssignment(reservation)
          ),
          Effect.let("seats", ({ reservation }) =>
            getReservationSeats(reservation)
          ),
          Effect.tap(({ assignment }) =>
            Effect.logInfo("Workspace table assignment started", {
              requiredTags: assignment.requiredTags,
            })
          ),
          Effect.bind("occupancyInput", ({ reservation }) =>
            getReservationOccupancyInput(reservation)
          ),
          Effect.bind("inventory", ({ occupancyInput }) =>
            loadInventory(getWorkspaceReservationIntervalDates(occupancyInput))
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
            ({ activeReservations, occupancyInput }) =>
              getWorkspaceTableOccupancyById(activeReservations, occupancyInput)
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
              assignment,
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
                assignment.requireEmptyTable,
                rankingOccupancyByTableId
              )
          ),
          Effect.bind("matchingTableId", validateTableAssignment),
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

      return { assignTableId } satisfies IWorkspaceTableAssignmentService;
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
              requireEmptyTable: false,
            }),
            "reserved-desk": ({ entryTier, monitorOption }) => ({
              requiredTags: [workspaceCoworkReservedDeskTableTag],
              isCandidateTable: (tableTags: ReadonlySet<string>) =>
                isWorkspaceCoworkTableCandidate(tableTags, {
                  entryTier,
                  ...(monitorOption && { monitorOption }),
                }),
              requireEmptyTable: false,
              scoreCoworkOpenSpaceCapacity: true as const,
            }),
            basic: ({ entryTier }) =>
              getRequiredTagsAssignment([`tier:${entryTier}`], false),
            plus: ({ entryTier }) =>
              getRequiredTagsAssignment([`tier:${entryTier}`], false),
            profi: ({ entryTier, monitorOption }) =>
              getRequiredTagsAssignment(
                [
                  `tier:${entryTier}`,
                  ...workspaceProductMonitorOptionTableTags[monitorOption],
                ],
                false
              ),
          })
        ),
      "meeting-room": () =>
        getRequiredTagsAssignment(
          [workspaceMeetingRoomReservationTableTag],
          true
        ),
      office: () =>
        getRequiredTagsAssignment([workspaceOfficeReservationTableTag], true),
    })
  );

const getReservationOccupancyInput = (
  reservation: WorkspaceTableAssignmentReservation
): Effect.Effect<Temporal.PlainDate | ReservationInterval, ValidationError> =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      // Occupancy must use the tier's authoritative reservation interval
      // (Open Space Prague 00:00-17:00 exclusive, every other tier Prague
      // midnight to next midnight), not the whole calendar day.
      cowork: ({ entryTier, date }) =>
        getReservationIntervalNormalization(
          getCoworkReservationIntervalInput(entryTier, date)
        ).pipe(
          Effect.mapError(
            (cause) =>
              new ValidationError({
                message: `Workspace cowork reservation interval must be valid for date: ${date}`,
                cause,
              })
          )
        ),
      "meeting-room": (meetingRoomReservation) =>
        Effect.succeed(meetingRoomReservation),
      office: (officeReservation) =>
        getReservationIntervalNormalization(
          getOfficeReservationIntervalInput(officeReservation)
        ).pipe(
          Effect.mapError(
            (cause) => new ValidationError({ message: cause.message, cause })
          )
        ),
    })
  );

const getReservationSeats = (
  reservation: WorkspaceTableAssignmentReservation
) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => workspaceBookingSeatCount,
      "meeting-room": () => workspaceBookingSeatCount,
      office: ({ seats }) => seats,
    })
  );

const validateTableAssignment = (input: {
  readonly assignment: WorkspaceTableAssignment;
  readonly matchingTable: Table | undefined;
  readonly matchingTables: readonly DotyposTable[];
}) =>
  Effect.succeed(input).pipe(
    Effect.filterOrFail(
      ({ matchingTables }) => matchingTables.length > 0,
      ({ assignment }) =>
        new ValidationError({
          message: `No active visible Dotypos workspace table matches tags: ${assignment.requiredTags.join(
            ", "
          )}`,
        })
    ),
    Effect.let("matchingTableId", ({ matchingTable }) =>
      matchingTable ? getAssignableDotyposTableId(matchingTable) : undefined
    ),
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
