import type { Table } from "@deskohub/dotypos/generated";
import {
  getWorkspaceTableCandidates,
  getWorkspaceTableSeatCapacity,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation";

export const getOfficeReservationSeatCapacity = (tables: readonly Table[]) =>
  getWorkspaceTableCandidates(tables, [workspaceOfficeReservationTableTag])
    .map(getWorkspaceTableSeatCapacity)
    .reduce<number>(
      (capacity, candidate) => Math.max(capacity, candidate ?? 0),
      0
    );
