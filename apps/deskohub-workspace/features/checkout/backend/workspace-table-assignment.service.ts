import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import { getAssignableDotyposTableId } from "@/features/checkout/backend/dotypos-table-id";
import {
  excludeExpiredLocalHolds,
  getWorkspaceTableOccupancyById,
  workspaceBookingGuestCount,
} from "@/features/checkout/backend/workspace-table-occupancy";
import {
  getWorkspaceTableCandidates,
  selectWorkspaceTableFromCandidates,
} from "@/features/checkout/backend/workspace-table-selection";
import {
  getWorkspaceProductByTier,
  isWorkspaceProductMonitorOption,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";

export interface WorkspaceTableAssignmentService {
  readonly assignTableId: (
    reservation: CheckoutDetailsJson["reservation"]
  ) => Effect.Effect<string, ExternalAPIError | NetworkError | ValidationError>;
}

export const WorkspaceTableAssignmentService =
  Context.Service<WorkspaceTableAssignmentService>(
    "WorkspaceTableAssignmentService"
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

          const product = getWorkspaceProductByTier(reservation.tier);
          const requiredTags = [`tier:${reservation.tier}`];
          yield* Effect.annotateLogsScoped({ product, requiredTags });

          if (product.requiresMonitorOption && !reservation.monitorOption) {
            yield* Effect.logWarning(
              "Workspace table assignment rejected: missing monitor option"
            );

            return yield* Effect.fail(
              new ValidationError({
                message: `Workspace reservation tier ${reservation.tier} requires a monitor option for Dotypos table assignment`,
              })
            );
          }

          if (
            reservation.monitorOption &&
            !isWorkspaceProductMonitorOption(reservation.monitorOption)
          ) {
            yield* Effect.logWarning(
              "Workspace table assignment rejected: unsupported monitor option"
            );

            return yield* Effect.fail(
              new ValidationError({
                message: `Workspace reservation monitor option is not supported for Dotypos table assignment: ${reservation.monitorOption}`,
              })
            );
          }

          if (reservation.monitorOption) {
            requiredTags.push(
              ...workspaceProductMonitorOptionTableTags[
                reservation.monitorOption
              ]
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

          const day = yield* Effect.try({
            try: () => Temporal.PlainDate.from(reservation.date),
            catch: () =>
              new ValidationError({
                message: `Workspace reservation date must be a valid YYYY-MM-DD date: ${reservation.date}`,
              }),
          });
          const occupancyByTableId = getWorkspaceTableOccupancyById(
            activeReservations,
            day
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
            workspaceBookingGuestCount
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
              tier: reservation.tier,
              date: reservation.date,
              coffee: reservation.coffee,
              monitorOption: reservation.monitorOption,
            })
          )
      ),
    });
  })
);
