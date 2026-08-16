import { DotyposProductIdSchema } from "@deskohub/dotypos";
import { Schema } from "effect";

export const goodsCartIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("GoodsCartId")
).annotate({
  identifier: "GoodsCartId",
  description: "Opaque identifier for one persisted goods cart.",
});

export type GoodsCartId = typeof goodsCartIdSchema.Type;

export const goodsCartRevisionSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0)
).annotate({
  identifier: "GoodsCartRevision",
  description: "Monotonic revision used for optimistic cart mutations.",
});

export type GoodsCartRevision = typeof goodsCartRevisionSchema.Type;

export const goodsCartQuantitySchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(2_147_483_647)
).annotate({
  identifier: "GoodsCartQuantity",
  description: "Positive quantity that fits the PostgreSQL integer boundary.",
});

export type GoodsCartQuantity = typeof goodsCartQuantitySchema.Type;

export const goodsCartItemSchema = Schema.Struct({
  productId: DotyposProductIdSchema,
  quantity: goodsCartQuantitySchema,
});

export type GoodsCartItem = typeof goodsCartItemSchema.Type;

export const goodsCartSchema = Schema.Struct({
  revision: goodsCartRevisionSchema,
  items: Schema.Array(goodsCartItemSchema),
});

export type GoodsCart = typeof goodsCartSchema.Type;

export const setGoodsCartItemInputSchema = Schema.Struct({
  expectedRevision: goodsCartRevisionSchema,
  productId: DotyposProductIdSchema,
  quantity: goodsCartQuantitySchema,
});

export type SetGoodsCartItemInput = typeof setGoodsCartItemInputSchema.Type;

export const removeGoodsCartItemInputSchema = Schema.Struct({
  expectedRevision: goodsCartRevisionSchema,
  productId: DotyposProductIdSchema,
});

export type RemoveGoodsCartItemInput =
  typeof removeGoodsCartItemInputSchema.Type;

export const emptyGoodsCart: GoodsCart = { revision: 0, items: [] };
