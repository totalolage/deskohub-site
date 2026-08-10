import { describe, expect, test } from "bun:test";
import {
  getWorkspaceProductTarget,
  workspaceProductTargetMatches,
  workspaceProductTargets,
} from "./product-target";

describe("workspace product targets", () => {
  test("defines one target for each reservation family", () => {
    expect(workspaceProductTargets).toEqual([
      { kind: "cowork" },
      { kind: "meeting-room" },
      { kind: "office" },
    ]);
  });

  test("reduces exact purchase identities to their family target", () => {
    expect(
      getWorkspaceProductTarget({ kind: "cowork", tier: "profi" })
    ).toEqual({ kind: "cowork" });
    expect(
      getWorkspaceProductTarget({
        kind: "meeting-room",
        duration: { unit: "day", amount: 1 },
      })
    ).toEqual({ kind: "meeting-room" });
    expect(
      getWorkspaceProductTarget({ kind: "office", seats: 4, dayCount: 3 })
    ).toEqual({ kind: "office" });
  });

  test("targets every exact cowork product through the cowork family", () => {
    const target = { kind: "cowork" } as const;

    for (const tier of ["basic", "plus", "profi"] as const) {
      expect(
        workspaceProductTargetMatches(target, { kind: "cowork", tier })
      ).toBe(true);
    }
  });

  test("targets every exact meeting-room product through the meeting-room family", () => {
    const target = { kind: "meeting-room" } as const;

    for (const duration of [
      { unit: "hour", amount: 1 },
      { unit: "hour", amount: 4 },
      { unit: "day", amount: 1 },
    ] as const) {
      expect(
        workspaceProductTargetMatches(target, {
          kind: "meeting-room",
          duration,
        })
      ).toBe(true);
    }
  });

  test("targets every exact office product through the office family", () => {
    const target = { kind: "office" } as const;

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

  test("does not match products from another reservation family", () => {
    expect(
      workspaceProductTargetMatches(
        { kind: "cowork" },
        { kind: "meeting-room", duration: { unit: "hour", amount: 1 } }
      )
    ).toBe(false);
    expect(
      workspaceProductTargetMatches(
        { kind: "meeting-room" },
        { kind: "office", seats: 1, dayCount: 1 }
      )
    ).toBe(false);
  });
});
