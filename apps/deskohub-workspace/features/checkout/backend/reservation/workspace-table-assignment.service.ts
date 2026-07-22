import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import { Context, Effect, Layer, Match } from "effect";
import { workspaceProductMonitorOptionTableTags } from "@/features/checkout/product-catalog";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { CoworkReservationDetails } from "@/features/reservation/cowork-reservation";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import type { StoredMeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import {
  getReservationDate,
  type ReservationInterval,
} from "@/features/reservation/reservation-interval";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { getAssignableDotyposTableId } from "./dotypos-table-id";
import {
  excludeExpiredLocalHolds,
  getWorkspaceTableOccupancyById,
  workspaceBookingGuestCount,
} from "./workspace-table-occupancy";
import {
  getWorkspaceTableCandidates,
  selectWorkspaceTableFromCandidates,
  workspaceMeetingRoomReservationTableTag,
} from "./workspace-table-selection";

type CoworkTableAssignmentReservation = StoredCoworkReservationDetails &
  Pick<CoworkReservationDetails, "date">;

type MeetingRoomTableAssignmentReservation =
  StoredMeetingRoomReservationDetails & ReservationInterval;

export type WorkspaceTableAssignmentReservation =
  | CoworkTableAssignmentReservation
  | MeetingRoomTableAssignmentReservation;

export interface IWorkspaceTableAssignmentService {
  readonly assignTableId: (
    reservation: WorkspaceTableAssignmentReservation
  ) => Effect.Effect<string, ExternalAPIError | NetworkError | ValidationError>;
}

export class WorkspaceTableAssignmentService extends Context.Service<
  WorkspaceTableAssignmentService,
  IWorkspaceTableAssignmentService
>()("@deskohub-workspace/checkout/WorkspaceTableAssignmentService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const workspaceReservations = yield* WorkspaceReservationRepository;

      const loadInventory = Effect.fn(
        "WorkspaceTableAssignmentService.loadInventory"
      )(() =>
        Effect.all(
          {
            tables: dotypos.getTables(),
            reservations: dotypos.listReservations(),
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
                Effect.orElseSucceed(() => [] as readonly string[])
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
          Effect.tap(({ assignment }) =>
            Effect.logInfo("Workspace table assignment started", {
              requiredTags: assignment.requiredTags,
            })
          ),
          Effect.bind("inventory", loadInventory),
          Effect.let("activeReservations", ({ inventory }) =>
            excludeExpiredLocalHolds(
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
          Effect.bind(
            "occupancyByTableId",
            ({ activeReservations, reservation }) =>
              getReservationOccupancyInput(reservation).pipe(
                Effect.map((occupancyInput) =>
                  getWorkspaceTableOccupancyById(
                    activeReservations,
                    occupancyInput
                  )
                )
              )
          ),
          Effect.tap(({ occupancyByTableId }) =>
            Effect.logDebug("Workspace table occupancy calculated", {
              occupancyByTableId: Object.fromEntries(occupancyByTableId),
            })
          ),
          Effect.let("matchingTables", ({ assignment, inventory }) =>
            getWorkspaceTableCandidates(
              inventory.tables,
              assignment.requiredTags
            )
          ),
          Effect.let(
            "matchingTable",
            ({ assignment, inventory, matchingTables, occupancyByTableId }) =>
              selectWorkspaceTableFromCandidates(
                matchingTables,
                inventory.tables,
                occupancyByTableId,
                workspaceBookingGuestCount,
                assignment.requireEmptyTable
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
) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (coworkReservation) =>
        Match.value(coworkReservation).pipe(
          Match.discriminatorsExhaustive("entryTier")({
            basic: ({ entryTier }) => ({
              requiredTags: [`tier:${entryTier}`],
              requireEmptyTable: false,
            }),
            plus: ({ entryTier }) => ({
              requiredTags: [`tier:${entryTier}`],
              requireEmptyTable: false,
            }),
            profi: ({ entryTier, monitorOption }) => ({
              requiredTags: [
                `tier:${entryTier}`,
                ...workspaceProductMonitorOptionTableTags[monitorOption],
              ],
              requireEmptyTable: false,
            }),
          })
        ),
      "meeting-room": () => ({
        requiredTags: [workspaceMeetingRoomReservationTableTag],
        requireEmptyTable: true,
      }),
    })
  );

const getReservationOccupancyInput = (
  reservation: WorkspaceTableAssignmentReservation
): Effect.Effect<Temporal.PlainDate | ReservationInterval, ValidationError> =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ date }) =>
        Effect.try({
          try: () => Temporal.PlainDate.from(date),
          catch: (cause) =>
            new ValidationError({
              message: `Workspace reservation date must be a valid YYYY-MM-DD date: ${date}`,
              cause,
            }),
        }),
      "meeting-room": (meetingRoomReservation) =>
        Effect.succeed(meetingRoomReservation),
    })
  );

const validateTableAssignment = (input: {
  readonly assignment: ReturnType<typeof getReservationAssignment>;
  readonly matchingTable: ReturnType<typeof selectWorkspaceTableFromCandidates>;
  readonly matchingTables: ReturnType<typeof getWorkspaceTableCandidates>;
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
        readonly matchingTableId: string;
      } => assignment.matchingTableId !== undefined,
      ({ assignment }) =>
        new ValidationError({
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
    })
  );
