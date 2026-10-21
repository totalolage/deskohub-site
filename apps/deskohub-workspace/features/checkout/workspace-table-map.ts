import {
  type DotyposReservation,
  type DotyposTable,
  type DotyposTableId,
  DotyposTableIdSchema,
} from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import { getAssignableDotyposTableId } from "./backend/reservation/dotypos-table-id";
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
  const assignedTableId = Option.getOrUndefined(
    Schema.decodeUnknownOption(DotyposTableIdSchema)(
      reservation._tableId?.trim()
    )
  );
  if (!assignedTableId) return undefined;

  const displayableTables = tables.filter(isDisplayableWorkspaceTable);
  const assignedTable = displayableTables.find(
    (table) => getAssignableDotyposTableId(table) === assignedTableId
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
