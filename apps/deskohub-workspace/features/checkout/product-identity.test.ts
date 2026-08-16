import { describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Schema } from "effect";
import {
  getWorkspaceProductKey,
  workspaceProductKeySchema,
} from "@/features/checkout/product-identity";

describe("workspace product identities", () => {
  test("dispatches canonical keys to their product domain", () => {
    expect(getWorkspaceProductKey({ kind: "cowork", tier: "basic" })).toBe(
      "cowork:basic"
    );
    expect(
      getWorkspaceProductKey({
        kind: "meeting-room",
        duration: { unit: "hour", amount: 1 },
      })
    ).toBe("meeting-room:hour:1");
    expect(
      getWorkspaceProductKey({ kind: "office", seats: 3, dayCount: 2 })
    ).toBe("office:3:2");
    expect(
      getWorkspaceProductKey({
        kind: "goods",
        categoryId: DotyposCategoryIdSchema.make("category-1"),
        productId: DotyposProductIdSchema.make("product-1"),
      })
    ).toBe("goods:category-1:product-1");
  });

  test("rejects non-canonical product keys", () => {
    const decode = Schema.decodeUnknownSync(workspaceProductKeySchema);

    expect(() => decode("cowork:enterprise")).toThrow();
    expect(() => decode("meeting-room:4")).toThrow();
    expect(() => decode("meeting-room:240-minutes")).toThrow();
    expect(() => decode("meeting-room:1440")).toThrow();
    expect(() => decode("office")).toThrow();
    expect(() => decode("office:3")).toThrow();
    expect(() => decode("office:0:2")).toThrow();
    expect(() => decode("office:1.5:2")).toThrow();
    expect(() => decode("office:3:0")).toThrow();
    expect(() => decode("goods:category-1")).toThrow();
  });
});
