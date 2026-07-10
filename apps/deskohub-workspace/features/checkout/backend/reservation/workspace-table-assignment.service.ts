import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import { Context, Effect, Layer, Match } from "effect";
import { workspaceProductMonitorOptionTableTags } from "@/features/checkout/product-catalog";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  getReservationDate,
  getReservationPragueDateRange,
} from "@/features/reservation/schemas/reservation-interval";
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
      requiredTags: [workspaceMeetingRoomReservationTableTag],
      requireEmptyTable: true,
    })),
    Match.tag("cowork", (coworkReservation) =>
      Match.value(coworkReservation).pipe(
        Match.when({ tier: "basic" }, (basicReservation) => ({
          logProduct: {
            tier: basicReservation.tier,
            coffee: basicReservation.coffee,
          },
          requiredTags: [`tier:${basicReservation.tier}`],
          requireEmptyTable: false,
        })),
        Match.when({ tier: "plus" }, (plusReservation) => ({
          logProduct: {
            tier: plusReservation.tier,
            coffee: plusReservation.coffee,
          },
          requiredTags: [`tier:${plusReservation.tier}`],
          requireEmptyTable: false,
        })),
        Match.when({ tier: "profi" }, (profiReservation) => ({
          logProduct: {
            tier: profiReservation.tier,
            coffee: profiReservation.coffee,
            monitorOption: profiReservation.monitorOption,
          },
          requiredTags: [
            `tier:${profiReservation.tier}`,
            ...workspaceProductMonitorOptionTableTags[
              profiReservation.monitorOption
            ],
          ],
          requireEmptyTable: false,
        })),
        Match.exhaustive
      )
    ),
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
          const { requireEmptyTable, requiredTags } = reservationAssignment;
          yield* Effect.annotateLogsScoped({ requiredTags });

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
              date: getReservationDate({
                interval: reservation,
                timeZone: workspaceSiteConstants.location.timeZone,
              }),
              ...getReservationAssignment(reservation).logProduct,
            })
          )
      ),
    });
  })
);
