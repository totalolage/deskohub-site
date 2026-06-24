import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { isDisplayableWorkspaceTable } from "./backend/workspace-table-selection";

export type WorkspaceTableMap = {
  readonly assignedTableId: string;
  readonly roomName?: string;
  readonly tables: readonly Table[];
};

const getTableId = (table: Pick<Table, "id">) => {
  const tableId = table.id?.trim();
  return tableId || undefined;
};

const getTableRoomName = (table: Pick<Table, "locationName">) => {
  const roomName = table.locationName?.trim();
  return roomName || undefined;
};

export const getWorkspaceTableMap = (
  reservation: Reservation,
  tables: readonly Table[]
): WorkspaceTableMap | undefined => {
  const assignedTableId = reservation._tableId?.trim();
  if (!assignedTableId) return undefined;

  const displayableTables = tables.filter(isDisplayableWorkspaceTable);
  const assignedTable = displayableTables.find(
    (table) => getTableId(table) === assignedTableId
  );
  if (!assignedTable) return undefined;

  const roomName = getTableRoomName(assignedTable);
  const roomTables = displayableTables.filter(
    (table) => getTableRoomName(table) === roomName
  );

  return {
    assignedTableId,
    ...(roomName ? { roomName } : {}),
    tables: roomTables.length ? roomTables : [assignedTable],
  };
};
