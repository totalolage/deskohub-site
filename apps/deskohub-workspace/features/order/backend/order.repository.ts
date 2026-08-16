import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { type OrderRow, orders } from "@/db/schema";
import type { OrderId } from "../order";

export interface IOrderRepository {
  readonly findById: (
    id: OrderId
  ) => Effect.Effect<OrderRow | null, EffectDrizzleQueryError>;
}

export class OrderRepository extends Context.Service<
  OrderRepository,
  IOrderRepository
>()("@deskohub-workspace/order/OrderRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return OrderRepository.of({
        findById: Effect.fn("OrderRepository.findById")(function* (id) {
          const [order] = yield* db
            .select()
            .from(orders)
            .where(eq(orders.id, id))
            .limit(1);
          return order ?? null;
        }),
      });
    })
  );
}
