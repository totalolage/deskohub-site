import {
  type DotyposReservation,
  type DotyposTable,
  type DotyposTableId,
  DotyposTableIdSchema,
} from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import { isDisplayableWorkspaceTable } from "./backend/reservation/workspace-table-selection";

export type WorkspaceTableMap = {
  readonly assignedTableId: DotyposTableId;
  readonly roomName?: string;
  readonly tables: readonly DotyposTable[];
};

const getTableId = (table: Pick<DotyposTable, "id">) => {
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(DotyposTableIdSchema)(table.id?.trim())
  );
};

const getTableRoomName = (table: Pick<DotyposTable, "locationName">) => {
  const roomName = table.locationName?.trim();
  return roomName || undefined;
};

export const getWorkspaceTableMap = (
  reservation: DotyposReservation,
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
    (table) => getTableId(table) === assignedTableId
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
