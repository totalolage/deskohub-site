import {
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import type { Table } from "@deskohub/dotypos/generated";
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
          const product = getWorkspaceProductByTier(reservation.tier);
          const requiredTags = [`tier:${reservation.tier}`];

          if (product.requiresMonitorOption && !reservation.monitorOption) {
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
          }

          const tables = yield* dotypos.getTables();
          const matchingTable = [...tables]
            .filter((table) => isAssignableTable(table, requiredTags))
            .sort(compareTables)[0];
          const matchingTableId = matchingTable
            ? getAssignableDotyposTableId(matchingTable)
            : undefined;

          if (!matchingTableId) {
            return yield* Effect.fail(
              new ValidationError({
                message: `No active visible Dotypos workspace table matches tags: ${requiredTags.join(
                  ", "
                )}`,
              })
            );
          }

          return matchingTableId;
        },
        (effect, reservation) =>
          effect.pipe(
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
