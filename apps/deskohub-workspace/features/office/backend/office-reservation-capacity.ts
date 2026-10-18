import { type DotyposTable, ValidationError } from "@deskohub/dotypos";
import { Effect } from "effect";
import {
  getWorkspaceTableCandidates,
  getWorkspaceTableSeatCapacity,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation/workspace-table-selection";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";

export const getOfficeReservationSeatCapacity = Effect.fn(function* (
  tables: readonly DotyposTable[]
) {
  const candidates = getWorkspaceTableCandidates(tables, [
    workspaceOfficeReservationTableTag,
  ]);
  if (candidates.length !== 1) {
    return yield* new ValidationError({
      message:
        "Office reservations require exactly one assignable office table.",
    });
  }

  return yield* getWorkspaceTableSeatCapacity(candidates[0]!);
});

/**
 * The office seat capacity from the shared advisory table snapshot, for reads
 * that must not reach Dotypos on their own.
 */
export const loadAdvisoryOfficeSeatCapacity =
  AdvisoryAvailabilityInventory.pipe(
    Effect.flatMap((inventory) => inventory.tables),
    Effect.flatMap(getOfficeReservationSeatCapacity),
    Effect.withSpan("office.loadAdvisorySeatCapacity")
  );
