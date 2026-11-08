import { describe, expect, test } from "bun:test";
import { getWorkspaceRoomLayout } from "./workspace-room-layouts";

describe("getWorkspaceRoomLayout", () => {
  test("returns the main room's layout with its entrance door", () => {
    const layout = getWorkspaceRoomLayout("Main room");

    expect(layout).toMatchObject({ width: 390, height: 530 });
    expect(layout.doors).toEqual([
      expect.objectContaining({ wall: "bottom", showEntranceArrow: true }),
    ]);
  });

  test.each([
    ["an unknown room", "Back office"],
    ["an empty room name", ""],
    ["a missing room name", undefined],
  ])("falls back to the default layout for %s", (_name, roomName) => {
    expect(getWorkspaceRoomLayout(roomName)).toBe(
      getWorkspaceRoomLayout("Main room")
    );
  });
});
