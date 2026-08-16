import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, asc, eq, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { goodsCartItems, goodsCarts } from "@/db/schema";
import type {
  GoodsCart,
  GoodsCartId,
  GoodsCartRevision,
  RemoveGoodsCartItemInput,
  SetGoodsCartItemInput,
} from "../goods-cart";
import { emptyGoodsCart } from "../goods-cart";

export class GoodsCartRevisionConflict extends Data.TaggedError(
  "GoodsCartRevisionConflict"
)<{
  readonly current: GoodsCart;
}> {}

type GoodsCartRepositoryError =
  | EffectDrizzleQueryError
  | SqlError
  | GoodsCartRevisionConflict;

interface IGoodsCartRepository {
  readonly get: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<GoodsCart, EffectDrizzleQueryError | SqlError>;
  readonly setItem: (
    customerId: DotyposCustomerId,
    input: SetGoodsCartItemInput
  ) => Effect.Effect<GoodsCart, GoodsCartRepositoryError>;
  readonly removeItem: (
    customerId: DotyposCustomerId,
    input: RemoveGoodsCartItemInput
  ) => Effect.Effect<GoodsCart, GoodsCartRepositoryError>;
}

export class GoodsCartRepository extends Context.Service<
  GoodsCartRepository,
  IGoodsCartRepository
>()("@deskohub-workspace/goods/GoodsCartRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const get = Effect.fn("GoodsCartRepository.get")(function* (
        customerId: DotyposCustomerId
      ) {
        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const [cart] = yield* tx
              .select({ id: goodsCarts.id, revision: goodsCarts.revision })
              .from(goodsCarts)
              .where(eq(goodsCarts.dotyposCustomerId, customerId))
              .limit(1)
              .for("share");
            if (!cart) return emptyGoodsCart;
            return yield* loadLockedCart(tx, cart);
          })
        );
      });

      const setItem = Effect.fn("GoodsCartRepository.setItem")(function* (
        customerId: DotyposCustomerId,
        input: SetGoodsCartItemInput
      ) {
        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .insert(goodsCarts)
              .values({ dotyposCustomerId: customerId })
              .onConflictDoNothing({
                target: goodsCarts.dotyposCustomerId,
              });
            const cart = yield* lockCart(tx, customerId);
            const current = yield* loadLockedCart(tx, cart);
            yield* requireRevision(input.expectedRevision, current);

            const existing = current.items.find(
              ({ productId }) => productId === input.productId
            );
            if (existing?.quantity === input.quantity) return current;

            yield* tx
              .insert(goodsCartItems)
              .values({
                cartId: cart.id,
                productId: input.productId,
                quantity: input.quantity,
              })
              .onConflictDoUpdate({
                target: [goodsCartItems.cartId, goodsCartItems.productId],
                set: { quantity: input.quantity },
              });
            return yield* advanceAndLoadCart(tx, cart);
          })
        );
      });

      const removeItem = Effect.fn("GoodsCartRepository.removeItem")(function* (
        customerId: DotyposCustomerId,
        input: RemoveGoodsCartItemInput
      ) {
        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const [cart] = yield* tx
              .select({ id: goodsCarts.id, revision: goodsCarts.revision })
              .from(goodsCarts)
              .where(eq(goodsCarts.dotyposCustomerId, customerId))
              .limit(1)
              .for("update");
            if (!cart) {
              yield* requireRevision(input.expectedRevision, emptyGoodsCart);
              return emptyGoodsCart;
            }

            const current = yield* loadLockedCart(tx, cart);
            yield* requireRevision(input.expectedRevision, current);
            if (
              !current.items.some(
                ({ productId }) => productId === input.productId
              )
            ) {
              return current;
            }

            yield* tx
              .delete(goodsCartItems)
              .where(
                and(
                  eq(goodsCartItems.cartId, cart.id),
                  eq(goodsCartItems.productId, input.productId)
                )
              );
            return yield* advanceAndLoadCart(tx, cart);
          })
        );
      });

      return { get, removeItem, setItem } satisfies IGoodsCartRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

type CartTransaction = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

type LockedCart = {
  readonly id: GoodsCartId;
  readonly revision: GoodsCartRevision;
};

const lockCart = Effect.fn("GoodsCartRepository.lockCart")(function* (
  tx: CartTransaction,
  customerId: DotyposCustomerId
) {
  const [cart] = yield* tx
    .select({ id: goodsCarts.id, revision: goodsCarts.revision })
    .from(goodsCarts)
    .where(eq(goodsCarts.dotyposCustomerId, customerId))
    .limit(1)
    .for("update");
  return cart ?? (yield* Effect.die("Goods cart insert returned no row."));
});

const loadLockedCart = Effect.fn("GoodsCartRepository.loadLockedCart")(
  function* (tx: CartTransaction, cart: LockedCart) {
    const items = yield* tx
      .select({
        productId: goodsCartItems.productId,
        quantity: goodsCartItems.quantity,
      })
      .from(goodsCartItems)
      .where(eq(goodsCartItems.cartId, cart.id))
      .orderBy(asc(goodsCartItems.productId));
    return { revision: cart.revision, items } satisfies GoodsCart;
  }
);

const requireRevision = Effect.fn("GoodsCartRepository.requireRevision")(
  function* (expected: GoodsCartRevision, current: GoodsCart) {
    if (expected !== current.revision) {
      return yield* new GoodsCartRevisionConflict({ current });
    }
  }
);

const advanceAndLoadCart = Effect.fn("GoodsCartRepository.advanceAndLoadCart")(
  function* (tx: CartTransaction, cart: LockedCart) {
    const nextRevision = cart.revision + 1;
    yield* tx
      .update(goodsCarts)
      .set({ revision: nextRevision, updatedAt: sql`now()` })
      .where(eq(goodsCarts.id, cart.id));
    return yield* loadLockedCart(tx, { ...cart, revision: nextRevision });
  }
);
