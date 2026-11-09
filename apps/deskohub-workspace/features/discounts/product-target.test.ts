import { describe, expect, test } from "bun:test";
import {
  findWorkspaceProductTargetsIssue,
  getWorkspaceProductTargetsCovering,
  workspaceProductTargetMatches,
  workspaceProductTargetsCoverFamily,
} from "./product-target";

describe("workspace product targets", () => {
  test("lists the family target and the saleable tier target covering a product", () => {
    expect(
      getWorkspaceProductTargetsCovering({ kind: "cowork", tier: "open-space" })
    ).toEqual([{ kind: "cowork" }, { kind: "cowork", tier: "open-space" }]);
    expect(
      getWorkspaceProductTargetsCovering({ kind: "cowork", tier: "profi" })
    ).toEqual([{ kind: "cowork" }]);
    expect(
      getWorkspaceProductTargetsCovering({
        kind: "meeting-room",
        duration: { unit: "day", amount: 1 },
      })
    ).toEqual([{ kind: "meeting-room" }]);
    expect(
      getWorkspaceProductTargetsCovering({
        kind: "office",
        seats: 4,
        dayCount: 3,
      })
    ).toEqual([{ kind: "office" }]);
  });

  test("targets every cowork tier through the broad cowork target", () => {
    const target = { kind: "cowork" } as const;

    for (const tier of [
      "basic",
      "plus",
      "profi",
      "open-space",
      "reserved-desk",
    ] as const) {
      expect(
        workspaceProductTargetMatches(target, { kind: "cowork", tier })
      ).toBe(true);
    }
  });

  test("targets only its own tier through a cowork tier target", () => {
    const target = { kind: "cowork", tier: "reserved-desk" } as const;

    expect(
      workspaceProductTargetMatches(target, {
        kind: "cowork",
        tier: "reserved-desk",
      })
    ).toBe(true);
    for (const tier of ["open-space", "basic", "plus", "profi"] as const) {
      expect(
        workspaceProductTargetMatches(target, { kind: "cowork", tier })
      ).toBe(false);
    }
    expect(
      workspaceProductTargetMatches(target, {
        kind: "meeting-room",
        duration: { unit: "hour", amount: 1 },
      })
    ).toBe(false);
  });

  test("treats every saleable cowork tier together as the whole family", () => {
    expect(
      workspaceProductTargetsCoverFamily([{ kind: "cowork" }], "cowork")
    ).toBe(true);
    expect(
      workspaceProductTargetsCoverFamily(
        [
          { kind: "cowork", tier: "open-space" },
          { kind: "cowork", tier: "reserved-desk" },
        ],
        "cowork"
      )
    ).toBe(true);
    expect(
      workspaceProductTargetsCoverFamily(
        [{ kind: "cowork", tier: "open-space" }, { kind: "meeting-room" }],
        "cowork"
      )
    ).toBe(false);
  });

  test("rejects repeated targets and a broad cowork target mixed with tiers", () => {
    expect(
      findWorkspaceProductTargetsIssue([
        { kind: "cowork", tier: "open-space" },
        { kind: "cowork", tier: "reserved-desk" },
        { kind: "meeting-room" },
      ])
    ).toBeUndefined();
    expect(
      findWorkspaceProductTargetsIssue([
        { kind: "cowork", tier: "open-space" },
        { kind: "cowork", tier: "open-space" },
      ])
    ).toBe("product targets must be unique");
    expect(
      findWorkspaceProductTargetsIssue([{ kind: "office" }, { kind: "office" }])
    ).toBe("product targets must be unique");
    expect(
      findWorkspaceProductTargetsIssue([
        { kind: "cowork" },
        { kind: "cowork", tier: "reserved-desk" },
      ])
    ).toBe(
      "a cowork target covering every tier cannot be combined with cowork tier targets"
    );
  });
});
