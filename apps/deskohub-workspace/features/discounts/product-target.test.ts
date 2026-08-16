import { describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import {
  getWorkspaceProductTarget,
  getWorkspaceProductTargetKey,
  workspaceProductTargetMatches,
  workspaceProductTargets,
} from "./product-target";

describe("workspace product targets", () => {
  test("defines each broad product target", () => {
    expect(workspaceProductTargets).toEqual([
      { kind: "cowork" },
      { kind: "meeting-room" },
      { kind: "office" },
      { kind: "goods" },
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
    expect(
      getWorkspaceProductTarget({
        kind: "goods",
        categoryId: DotyposCategoryIdSchema.make("category-1"),
        productId: DotyposProductIdSchema.make("product-1"),
      })
    ).toEqual({ kind: "goods", productId: "product-1" });
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

  test("matches broad and precise goods targets", () => {
    const product = {
      kind: "goods" as const,
      categoryId: DotyposCategoryIdSchema.make("category-1"),
      productId: DotyposProductIdSchema.make("product-1"),
    };

    expect(workspaceProductTargetMatches({ kind: "goods" }, product)).toBe(
      true
    );
    expect(
      workspaceProductTargetMatches(
        { kind: "goods", categoryId: product.categoryId },
        product
      )
    ).toBe(true);
    expect(
      workspaceProductTargetMatches(
        { kind: "goods", productId: product.productId },
        product
      )
    ).toBe(true);
    expect(
      workspaceProductTargetMatches(
        {
          kind: "goods",
          productId: DotyposProductIdSchema.make("product-2"),
        },
        product
      )
    ).toBe(false);
  });

  test("keys distinct goods targets by their full targeting scope", () => {
    expect(getWorkspaceProductTargetKey({ kind: "goods" })).toBe("goods");
    expect(
      getWorkspaceProductTargetKey({
        kind: "goods",
        categoryId: DotyposCategoryIdSchema.make("category-1"),
      })
    ).toBe("goods:category:category-1");
    expect(
      getWorkspaceProductTargetKey({
        kind: "goods",
        productId: DotyposProductIdSchema.make("product-1"),
      })
    ).toBe("goods:product:product-1");
  });
});
