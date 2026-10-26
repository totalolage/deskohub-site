import type { DotyposTable } from "@deskohub/dotypos";
import { Data, Effect } from "effect";
import {
  getWorkspaceTableCandidates,
  getWorkspaceTableSeatCapacity,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation/workspace-table-selection";

/** Workspace's Dotypos tables don't hold exactly one assignable office table. */
class OfficeTableUnconfigured extends Data.TaggedError(
  "OfficeTableUnconfigured"
)<{ readonly message: string }> {}

export const getOfficeReservationSeatCapacity = Effect.fn(function* (
  tables: readonly DotyposTable[]
) {
  const candidates = getWorkspaceTableCandidates(tables, [
    workspaceOfficeReservationTableTag,
  ]);
  if (candidates.length !== 1) {
    return yield* new OfficeTableUnconfigured({
      message:
        "Office reservations require exactly one assignable office table.",
    });
  }

  return yield* getWorkspaceTableSeatCapacity(candidates[0]!);
});
