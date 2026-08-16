import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { goodsCartItems, goodsCarts } from "./goods-carts";

describe("goods carts", () => {
  test("persists only ownership, revision, product identity, and quantity", () => {
    const cartConfig = getTableConfig(goodsCarts);
    const itemConfig = getTableConfig(goodsCartItems);

    expect(cartConfig.columns.map(({ name }) => name)).toEqual([
      "id",
      "dotypos_customer_id",
      "revision",
      "created_at",
      "updated_at",
    ]);
    expect(itemConfig.columns.map(({ name }) => name)).toEqual([
      "cart_id",
      "product_id",
      "quantity",
    ]);
    expect(cartConfig.indexes.map(({ config }) => config.name)).toContain(
      "goods_carts_customer_unique_idx"
    );
    expect(itemConfig.primaryKeys.map(({ name }) => name)).toEqual([
      "goods_cart_items_pk",
    ]);
    expect(itemConfig.foreignKeys).toHaveLength(1);

    const persistedColumns = [...cartConfig.columns, ...itemConfig.columns]
      .map(({ name }) => name)
      .join(" ");
    expect(persistedColumns).not.toMatch(
      /email|phone|customer_name|product_name|description|price|amount|stock/
    );
  });
});
