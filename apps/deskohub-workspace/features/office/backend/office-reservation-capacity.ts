import type { Table } from "@deskohub/dotypos/generated";
import { Effect } from "effect";
import {
  getWorkspaceTableCandidates,
  getWorkspaceTableSeatCapacity,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation";

export const getOfficeReservationSeatCapacity = (tables: readonly Table[]) =>
  Effect.forEach(
    getWorkspaceTableCandidates(tables, [workspaceOfficeReservationTableTag]),
    getWorkspaceTableSeatCapacity
  ).pipe(
    Effect.map((seatCapacities) =>
      seatCapacities.reduce(
        (capacity, seatCapacity) => Math.max(capacity, seatCapacity),
        0
      )
    )
  );
