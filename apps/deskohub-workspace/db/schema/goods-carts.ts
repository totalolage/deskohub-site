import type { DotyposCustomerId, DotyposProductId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  GoodsCartId,
  GoodsCartQuantity,
  GoodsCartRevision,
} from "@/features/goods/goods-cart";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";

export const goodsCarts = pgTable(
  "goods_carts",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<GoodsCartId>(),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    revision: integer("revision")
      .notNull()
      .default(0)
      .$type<GoodsCartRevision>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("goods_carts_customer_unique_idx").on(t.dotyposCustomerId),
    check(
      "goods_carts_customer_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
    check("goods_carts_revision_check", sql`${t.revision} >= 0`),
  ]
);

export const goodsCartItems = pgTable(
  "goods_cart_items",
  {
    cartId: text("cart_id")
      .notNull()
      .$type<GoodsCartId>()
      .references(() => goodsCarts.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull().$type<DotyposProductId>(),
    quantity: integer("quantity").notNull().$type<GoodsCartQuantity>(),
  },
  (t) => [
    primaryKey({
      name: "goods_cart_items_pk",
      columns: [t.cartId, t.productId],
    }),
    index("goods_cart_items_cart_idx").on(t.cartId),
    check("goods_cart_items_product_check", sql`btrim(${t.productId}) <> ''`),
    check("goods_cart_items_quantity_check", sql`${t.quantity} > 0`),
  ]
);

export type GoodsCartRow = typeof goodsCarts.$inferSelect;
export type GoodsCartItemRow = typeof goodsCartItems.$inferSelect;
