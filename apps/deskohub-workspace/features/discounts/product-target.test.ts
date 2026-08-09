import { describe, expect, test } from "bun:test";
import {
  getWorkspaceProductTargetKey,
  workspaceProductTargetMatches,
} from "./product-target";

describe("workspace product targets", () => {
  test("targets every exact office product through the office family", () => {
    const target = { kind: "office" } as const;

    expect(getWorkspaceProductTargetKey(target)).toBe("office");
    expect(
      workspaceProductTargetMatches(target, {
        kind: "office",
        seats: 1,
        dayCount: 1,
      })
    ).toBe(true);
    expect(
      workspaceProductTargetMatches(target, {
        kind: "office",
        seats: 4,
        dayCount: 12,
      })
    ).toBe(true);
  });

  test("matches fixed catalog products exactly", () => {
    expect(
      workspaceProductTargetMatches(
        { kind: "cowork", tier: "basic" },
        { kind: "cowork", tier: "plus" }
      )
    ).toBe(false);
    expect(
      workspaceProductTargetMatches(
        { kind: "meeting-room", duration: { unit: "hour", amount: 1 } },
        { kind: "meeting-room", duration: { unit: "hour", amount: 1 } }
      )
    ).toBe(true);
  });
});
