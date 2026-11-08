import type {
  DotyposReservation,
  DotyposTable,
  DotyposTableId,
} from "@deskohub/dotypos";
import { isDisplayableWorkspaceTable } from "./backend/reservation/workspace-table-selection";

export type WorkspaceTableMap = {
  readonly assignedTableId: DotyposTableId;
  readonly roomName?: string;
  readonly tables: readonly DotyposTable[];
};

const getTableRoomName = (table: Pick<DotyposTable, "locationName">) => {
  const roomName = table.locationName?.trim();
  return roomName || undefined;
};

export const getWorkspaceTableMap = (
  reservation: Pick<DotyposReservation, "_tableId">,
  tables: readonly DotyposTable[]
): WorkspaceTableMap | undefined => {
  const assignedTableId = reservation._tableId;
  if (!assignedTableId) return undefined;

  const displayableTables = tables.filter(isDisplayableWorkspaceTable);
  const assignedTable = displayableTables.find(
    (table) => table.id === assignedTableId
  );
  if (!assignedTable) return undefined;

  const roomName = getTableRoomName(assignedTable);
  const roomTables = displayableTables.filter(
    (table) => getTableRoomName(table) === roomName
  );

  return {
    assignedTableId,
    roomName: roomName || undefined,
    tables: roomTables.length ? roomTables : [assignedTable],
  };
};
