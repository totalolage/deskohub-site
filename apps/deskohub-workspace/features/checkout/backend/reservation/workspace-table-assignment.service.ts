import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import { Context, Effect, Layer, Match } from "effect";
import {
  getWorkspaceProductByTier,
  isWorkspaceProductMonitorOption,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  getReservationPragueDate,
  getReservationPragueDateRange,
} from "@/features/reservation/schemas/reservation-interval";
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

export interface WorkspaceTableAssignmentService {
  readonly assignTableId: (
    reservation: CheckoutDetailsJson["reservation"]
  ) => Effect.Effect<string, ExternalAPIError | NetworkError | ValidationError>;
}

export const WorkspaceTableAssignmentService =
  Context.Service<WorkspaceTableAssignmentService>(
    "WorkspaceTableAssignmentService"
  );

const getReservationAssignment = (
  reservation: CheckoutDetailsJson["reservation"]
) =>
  Match.value(reservation).pipe(
    Match.tag("meeting-room", () => ({
      logProduct: {},
      monitorOption: undefined,
      requiredTags: [workspaceMeetingRoomReservationTableTag],
      requireEmptyTable: true,
    })),
    Match.tag("cowork", (coworkReservation) => ({
      logProduct: {
        tier: coworkReservation.tier,
        coffee: coworkReservation.coffee,
        monitorOption: coworkReservation.monitorOption,
      },
      monitorOption: coworkReservation.monitorOption,
      requiredTags: [`tier:${coworkReservation.tier}`],
      requireEmptyTable: false,
    })),
    Match.exhaustive
  );

export const WorkspaceTableAssignmentServiceLive = Layer.effect(
  WorkspaceTableAssignmentService,
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const workspaceReservations = yield* WorkspaceReservationRepository;

    return WorkspaceTableAssignmentService.of({
      assignTableId: Effect.fn("workspaceTableAssignment.assignTableId")(
        function* (reservation) {
          yield* Effect.annotateLogsScoped({ reservation });
          yield* Effect.logInfo("Workspace table assignment started");

          const reservationAssignment = getReservationAssignment(reservation);
          const { monitorOption, requireEmptyTable, requiredTags } =
            reservationAssignment;
          const product =
            reservation._tag === "cowork"
              ? getWorkspaceProductByTier(reservation.tier)
              : undefined;
          yield* Effect.annotateLogsScoped({ product, requiredTags });

          if (product?.requiresMonitorOption && !monitorOption) {
            yield* Effect.logWarning(
              "Workspace table assignment rejected: missing monitor option"
            );

            return yield* Effect.fail(
              new ValidationError({
                message: `Workspace reservation tier ${
                  reservation._tag === "cowork"
                    ? reservation.tier
                    : reservation._tag
                } requires a monitor option for Dotypos table assignment`,
              })
            );
          }

          if (
            monitorOption &&
            !isWorkspaceProductMonitorOption(monitorOption)
          ) {
            yield* Effect.logWarning(
              "Workspace table assignment rejected: unsupported monitor option"
            );

            return yield* Effect.fail(
              new ValidationError({
                message: `Workspace reservation monitor option is not supported for Dotypos table assignment: ${monitorOption}`,
              })
            );
          }

          if (monitorOption) {
            requiredTags.push(
              ...workspaceProductMonitorOptionTableTags[monitorOption]
            );
            yield* Effect.annotateLogsScoped({ requiredTags });
          }

          const [tables, reservations, expiredDotyposReservationIds] =
            yield* Effect.all([
              dotypos.getTables(),
              dotypos.listReservations(),
              workspaceReservations
                .selectExpiredHoldDotyposReservationIds({ now: new Date() })
                .pipe(
                  Effect.tapError((cause) =>
                    Effect.logWarning(
                      "Workspace table assignment expired hold filter failed",
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
          yield* Effect.annotateLogsScoped({ tables, reservations });
          yield* Effect.logInfo("Workspace table assignment inventory loaded");

          const range = yield* getReservationPragueDateRange(reservation).pipe(
            Effect.mapError(
              (cause) =>
                new ValidationError({
                  message:
                    "Workspace reservation interval must be valid for table assignment.",
                  cause,
                })
            )
          );
          const occupancyByTableId = getWorkspaceTableOccupancyById(
            activeReservations,
            range
          );
          yield* Effect.annotateLogsScoped({
            occupancyByTableId: Object.fromEntries(occupancyByTableId),
          });

          const matchingTables = getWorkspaceTableCandidates(
            tables,
            requiredTags
          );
          yield* Effect.annotateLogsScoped({ matchingTables });

          const matchingTable = selectWorkspaceTableFromCandidates(
            matchingTables,
            tables,
            occupancyByTableId,
            workspaceBookingGuestCount,
            requireEmptyTable
          );
          const matchingTableId = matchingTable
            ? getAssignableDotyposTableId(matchingTable)
            : undefined;

          if (matchingTables.length === 0) {
            yield* Effect.logWarning(
              "Workspace table assignment rejected: no matching table"
            );

            return yield* Effect.fail(
              new ValidationError({
                message: `No active visible Dotypos workspace table matches tags: ${requiredTags.join(
                  ", "
                )}`,
              })
            );
          }

          if (!matchingTableId) {
            yield* Effect.logWarning(
              "Workspace table assignment rejected: no available table"
            );

            return yield* Effect.fail(
              new ValidationError({
                message: `No available Dotypos workspace table matches tags: ${requiredTags.join(
                  ", "
                )}`,
              })
            );
          }

          yield* Effect.annotateLogsScoped({ matchingTable, matchingTableId });
          yield* Effect.logDebug("Workspace table assigned");

          return matchingTableId;
        },
        (effect, reservation) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({
              reservationKind: reservation._tag,
              ...(reservation._tag === "cowork"
                ? { tier: reservation.tier }
                : {}),
              date: getReservationPragueDate(reservation),
              ...getReservationAssignment(reservation).logProduct,
            })
          )
      ),
    });
  })
);
