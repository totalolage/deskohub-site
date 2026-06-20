"use client";

import type { Table } from "@deskohub/dotypos/generated";
import { TableMap } from "@deskohub/dotypos/table-map";
import { getWorkspaceRoomLayout } from "@/features/checkout/workspace-room-layouts";

type CheckoutStatusTableMapProps = {
  readonly ariaLabel: string;
  readonly assignedTableId: string;
  readonly roomName?: string;
  readonly tables: readonly Table[];
};

const getTableClassName = (table: Table, assignedTableId: string) => {
  if (table.id?.trim() === assignedTableId) {
    return "fill-navy-blue stroke-navy-blue stroke-4";
  }

  return "fill-aquamarine-green/22 stroke-navy-blue/25 stroke-2";
};

const getTableLabelClassName = (table: Table, assignedTableId: string) =>
  table.id?.trim() === assignedTableId ? "fill-white" : "fill-navy-blue";

export function CheckoutStatusTableMap({
  ariaLabel,
  assignedTableId,
  roomName,
  tables,
}: CheckoutStatusTableMapProps) {
  return (
    <TableMap
      ariaLabel={ariaLabel}
      roomLayout={getWorkspaceRoomLayout(roomName)}
      tables={tables}
      tableLabelStyle={(table) =>
        getTableLabelClassName(table, assignedTableId)
      }
      tableStyle={(table) => getTableClassName(table, assignedTableId)}
    />
  );
}
