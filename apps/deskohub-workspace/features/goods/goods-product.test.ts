import { describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Schema } from "effect";
import {
  getWorkspaceGoodsProductKey,
  workspaceGoodsProductIdentitySchema,
  workspaceGoodsProductKeySchema,
  workspaceGoodsTargetMatches,
  workspaceGoodsTargetSchema,
} from "./goods-product";

const categoryId = DotyposCategoryIdSchema.make("category-1");
const productId = DotyposProductIdSchema.make("product-1");
const product = workspaceGoodsProductIdentitySchema.make({
  kind: "goods",
  categoryId,
  productId,
});

describe("Workspace goods products", () => {
  test("owns an exact Dotypos category and product identity", () => {
    expect(product).toEqual({ kind: "goods", categoryId, productId });
    expect(getWorkspaceGoodsProductKey(product)).toBe(
      'goods:["category-1","product-1"]'
    );
    expect(
      Schema.decodeUnknownSync(workspaceGoodsProductKeySchema)(
        'goods:["category-1","product-1"]'
      )
    ).toBe('goods:["category-1","product-1"]');
  });

  test("keeps opaque category and product boundaries unambiguous", () => {
    const first = workspaceGoodsProductIdentitySchema.make({
      kind: "goods",
      categoryId: DotyposCategoryIdSchema.make("a:b"),
      productId: DotyposProductIdSchema.make("c"),
    });
    const second = workspaceGoodsProductIdentitySchema.make({
      kind: "goods",
      categoryId: DotyposCategoryIdSchema.make("a"),
      productId: DotyposProductIdSchema.make("b:c"),
    });

    expect(getWorkspaceGoodsProductKey(first)).not.toBe(
      getWorkspaceGoodsProductKey(second)
    );
    expect(() =>
      Schema.decodeUnknownSync(workspaceGoodsProductKeySchema)("goods:a:b:c")
    ).toThrow();
  });

  test("accepts broad, category, and product targets but rejects both IDs", () => {
    const decode = Schema.decodeUnknownSync(workspaceGoodsTargetSchema);

    expect(decode({ kind: "goods" })).toEqual({ kind: "goods" });
    expect(decode({ kind: "goods", categoryId })).toEqual({
      kind: "goods",
      categoryId,
    });
    expect(decode({ kind: "goods", productId })).toEqual({
      kind: "goods",
      productId,
    });
    expect(() => decode({ kind: "goods", categoryId, productId })).toThrow();
  });

  test("matches goods targets at the requested precision", () => {
    expect(workspaceGoodsTargetMatches({ kind: "goods" }, product)).toBe(true);
    expect(
      workspaceGoodsTargetMatches({ kind: "goods", categoryId }, product)
    ).toBe(true);
    expect(
      workspaceGoodsTargetMatches(
        {
          kind: "goods",
          categoryId: DotyposCategoryIdSchema.make("category-2"),
        },
        product
      )
    ).toBe(false);
    expect(
      workspaceGoodsTargetMatches({ kind: "goods", productId }, product)
    ).toBe(true);
    expect(
      workspaceGoodsTargetMatches(
        {
          kind: "goods",
          productId: DotyposProductIdSchema.make("product-2"),
        },
        product
      )
    ).toBe(false);
  });
});
