import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Context, Effect, Layer } from "effect";
import { getAssignableDotyposTableId } from "@/features/checkout/backend/dotypos-table-id";
import {
  getWorkspaceProductByTier,
  isWorkspaceProductMonitorOption,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";

const tableNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export interface WorkspaceTableAssignmentService {
  readonly assignTableId: (
    reservation: CheckoutDetailsJson["reservation"]
  ) => Effect.Effect<string, ExternalAPIError | NetworkError | ValidationError>;
}

export const WorkspaceTableAssignmentService =
  Context.GenericTag<WorkspaceTableAssignmentService>(
    "WorkspaceTableAssignmentService"
  );

export const WorkspaceTableAssignmentServiceLive = Layer.effect(
  WorkspaceTableAssignmentService,
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;

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

          const [tables, reservations] = yield* Effect.all(
            [dotypos.getTables(), dotypos.listReservations()],
            { concurrency: 2 }
          );
          yield* Effect.annotateLogsScoped({ tables, reservations });
          yield* Effect.logInfo("Workspace table assignment inventory loaded");

          const occupiedTableIds = yield* getOccupiedTableIds(
            reservations,
            reservation.date
          );
          yield* Effect.annotateLogsScoped({
            occupiedTableIds: Array.from(occupiedTableIds),
          });

          const matchingTables = [...tables]
            .filter((table) => isAssignableTable(table, requiredTags))
            .sort(compareTables);
          yield* Effect.annotateLogsScoped({ matchingTables });

          const matchingTable = matchingTables.find((table) => {
            const tableId = getAssignableDotyposTableId(table);
            return tableId && !occupiedTableIds.has(tableId);
          });
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

const isAssignableTable = (table: Table, requiredTags: readonly string[]) => {
  const tableTags = new Set(table.tags ?? []);

  return (
    getAssignableDotyposTableId(table) !== undefined &&
    table.enabled === true &&
    table.display === true &&
    requiredTags.every((tag) => tableTags.has(tag))
  );
};

const compareTables = (left: Table, right: Table) => {
  const nameComparison = tableNameCollator.compare(left.name, right.name);

  if (nameComparison !== 0) return nameComparison;

  return (left.id ?? "").localeCompare(right.id ?? "");
};

const getOccupiedTableIds = (
  reservations: readonly Reservation[],
  date: string
): Effect.Effect<Set<string>, ValidationError> =>
  Effect.gen(function* () {
    const day = yield* Effect.try({
      try: () => Temporal.PlainDate.from(date),
      catch: () =>
        new ValidationError({
          message: `Workspace reservation date must be a valid YYYY-MM-DD date: ${date}`,
        }),
    });
    const dayRange = getPragueDayRange(day);
    const occupied = new Set<string>();

    for (const reservation of reservations) {
      if (reservation.status === "CANCELLED") continue;
      if (reservation.status !== "NEW" && reservation.status !== "CONFIRMED") {
        continue;
      }
      if (!reservation._tableId) continue;

      const reservationStart = Date.parse(reservation.startDate);
      const reservationEnd = Date.parse(reservation.endDate);
      if (
        !Number.isFinite(reservationStart) ||
        !Number.isFinite(reservationEnd)
      ) {
        continue;
      }

      if (
        reservationStart < dayRange.endMs &&
        reservationEnd > dayRange.startMs
      ) {
        occupied.add(reservation._tableId);
      }
    }

    return occupied;
  });

const getPragueDayRange = (date: Temporal.PlainDate) => {
  const startMs = date
    .toZonedDateTime({ timeZone: "Europe/Prague" })
    .toInstant().epochMilliseconds;
  const endMs = date
    .add({ days: 1 })
    .toZonedDateTime({ timeZone: "Europe/Prague" })
    .toInstant().epochMilliseconds;

  return { startMs, endMs };
};
