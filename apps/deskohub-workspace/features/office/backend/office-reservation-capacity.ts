import { ValidationError } from "@deskohub/dotypos";
import type { Table } from "@deskohub/dotypos/generated";
import { Effect } from "effect";
import {
  getWorkspaceTableCandidates,
  getWorkspaceTableSeatCapacity,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation";

export const getOfficeReservationSeatCapacity = (tables: readonly Table[]) =>
  Effect.gen(function* () {
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
