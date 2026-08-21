import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import { type OrderRow, orders, workspaceReservations } from "@/db/schema";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { OrderId } from "../order";
import { ensureReservationOrder } from "./reservation-order";

export interface IOrderRepository {
  readonly findById: (
    id: OrderId
  ) => Effect.Effect<OrderRow | null, EffectDrizzleQueryError | SqlError>;
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
          return yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const [order] = yield* tx
                .select()
                .from(orders)
                .where(eq(orders.id, id))
                .limit(1);
              if (order) return order;

              const [reservation] = yield* tx
                .select()
                .from(workspaceReservations)
                .where(
                  eq(
                    workspaceReservations.id,
                    workspaceReservationIdSchema.make(id)
                  )
                )
                .limit(1)
                .for("update");
              return reservation
                ? yield* ensureReservationOrder({ tx, reservation })
                : null;
            })
          );
        }),
      });
    })
  );
}
