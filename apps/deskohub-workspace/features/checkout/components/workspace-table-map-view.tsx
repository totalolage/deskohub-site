import { TableMap } from "@deskohub/dotypos/table-map";
import type { CSSProperties } from "react";
import { getWorkspaceRoomLayout } from "@/features/checkout/workspace-room-layouts";
import type { WorkspaceTableMap } from "@/features/checkout/workspace-table-map";

type WorkspaceTableMapViewProps = {
  readonly ariaLabel: string;
  readonly tableMap: WorkspaceTableMap;
};

export const workspaceTableMapFontFamily = "Sculpin";
export const workspaceTableMapFontStack = `${workspaceTableMapFontFamily}, "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
export const workspaceTableMapLabelWidth = 96;
export const workspaceTableMapImageWidth = 720;
export const workspaceTableMapImageHeight = 540;

const getRoomLayout = (roomName: string | undefined) => ({
  ...getWorkspaceRoomLayout(roomName),
  style: {
    fill: "#ffffff",
    fillOpacity: 0.72,
    stroke: "#00024f",
    strokeOpacity: 0.18,
    strokeWidth: 3,
  } satisfies CSSProperties,
});

const isAssignedTable = (
  tableId: string | undefined,
  assignedTableId: string
) => tableId?.trim() === assignedTableId;

const getTableShapeStyle = (
  tableId: string | undefined,
  assignedTableId: string
): CSSProperties =>
  isAssignedTable(tableId, assignedTableId)
    ? {
        fill: "#00024f",
        stroke: "#00024f",
        strokeWidth: 4,
      }
    : {
        fill: "#ccf7ea",
        stroke: "#00024f",
        strokeOpacity: 0.25,
        strokeWidth: 2,
      };

const getTableLabelStyle = (
  tableId: string | undefined,
  assignedTableId: string
): CSSProperties => ({
  fill: isAssignedTable(tableId, assignedTableId) ? "#ffffff" : "#00024f",
  fontFamily: workspaceTableMapFontStack,
  fontSize: 15,
  fontWeight: 800,
});

export function WorkspaceTableMapView({
  ariaLabel,
  tableMap,
}: WorkspaceTableMapViewProps) {
  return (
    <TableMap
      ariaLabel={ariaLabel}
      height={workspaceTableMapImageHeight}
      roomLayout={getRoomLayout(tableMap.roomName)}
      rotation={-90}
      style={{ background: "#ffffff", fontFamily: workspaceTableMapFontStack }}
      tableLabelInlineStyle={(table) =>
        getTableLabelStyle(table.id, tableMap.assignedTableId)
      }
      tableShapeInlineStyle={(table) =>
        getTableShapeStyle(table.id, tableMap.assignedTableId)
      }
      tableStyle={() => ""}
      tables={tableMap.tables}
      width={workspaceTableMapImageWidth}
    />
  );
}
