import type { TableMapRoomLayout } from "@deskohub/dotypos/table-map";

const defaultRoomLayout: TableMapRoomLayout = {
  x: -70,
  y: -70,
  width: 390,
  height: 530,
  className: "fill-white/70 stroke-navy-blue/18 stroke-3",
  doors: [
    {
      wall: "bottom",
      offset: 54,
      width: 48,
      showEntranceArrow: true,
    },
  ],
};

// ponytail: first-pass rectangle; replace with measured room geometry as the map gets tuned.
const workspaceRoomLayouts: Record<string, TableMapRoomLayout> = {
  "Main room": defaultRoomLayout,
};

export const getWorkspaceRoomLayout = (roomName: string | undefined) =>
  (roomName && workspaceRoomLayouts[roomName]) || defaultRoomLayout;
