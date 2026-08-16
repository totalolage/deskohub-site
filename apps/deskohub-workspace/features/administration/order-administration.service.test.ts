import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { OrderAdministrationService } from "./order-administration.service";

const instant = Temporal.Instant.from("2026-08-16T12:00:00Z");

const order = {
  id: "order-1",
  kind: "goods" as const,
  customerId: "customer-1",
  paymentState: "pending" as const,
  fulfillmentState: "fulfilled" as const,
  reservationId: null,
  paidAt: null,
  fulfilledAt: instant,
  fulfillmentFailedAt: null,
  writtenOffAt: null,
  createdAt: instant,
  updatedAt: instant,
};

const makeQuery = <A>(rows: readonly A[]) => {
  const result = Effect.succeed(rows);
  return Object.assign(result, {
    from: () => result,
    leftJoin: () => result,
    where: () => result,
    orderBy: () => result,
    limit: () => result,
  });
};

type TestSelection = {
  readonly customerId?: unknown;
  readonly id?: unknown;
  readonly productIdentity?: unknown;
  readonly provider?: unknown;
};

type WriteOffUpdate = {
  readonly updatedAt?: Temporal.Instant;
  readonly writtenOffAt?: Temporal.Instant;
};

const makeLayer = (rows: {
  readonly orders: readonly unknown[];
  readonly lines: readonly unknown[];
  readonly attempts?: readonly unknown[];
  readonly invoices?: readonly unknown[];
}) =>
  OrderAdministrationService.Default.pipe(
    Layer.provide(
      Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({
          db: {
            select: (selection: TestSelection) => {
              if ("customerId" in selection) return makeQuery(rows.orders);
              if ("productIdentity" in selection) return makeQuery(rows.lines);
              if ("provider" in selection) {
                return makeQuery(rows.attempts ?? []);
              }
              return makeQuery(rows.invoices ?? []);
            },
          } as never,
        })
      )
    )
  );

describe("OrderAdministrationService", () => {
  test("keeps historical reservation totals unavailable when no lines exist", async () => {
    const result = await Effect.gen(function* () {
      const administration = yield* OrderAdministrationService;
      return yield* administration.listOrders();
    }).pipe(
      Effect.provide(
        makeLayer({ orders: [{ ...order, kind: "reservation" }], lines: [] })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      items: [expect.objectContaining({ id: "order-1", total: null })],
      truncated: false,
    });
  });

  test("projects immutable lines and payment attempts without provider identifiers", async () => {
    const result = await Effect.gen(function* () {
      const administration = yield* OrderAdministrationService;
      return yield* administration.loadOrder("order-1");
    }).pipe(
      Effect.provide(
        makeLayer({
          orders: [order],
          lines: [
            {
              id: "line-1",
              orderId: "order-1",
              sequence: 0,
              productIdentity: {
                kind: "goods",
                categoryId: "category-1",
                productId: "product-1",
              },
              description: "Synthetic drink",
              quantity: 2,
              unitPriceValue: 2500,
              undiscountedTotalValue: 5000,
              payableTotalValue: 4500,
              amountExponent: 2,
              currency: "CZK",
              createdAt: instant,
            },
          ],
          attempts: [
            {
              id: "attempt-1",
              provider: "nexi",
              state: "pending",
              refundState: "not_required",
              amountValue: 4500,
              amountExponent: 2,
              currency: "CZK",
              providerOrderCreatedAt: instant,
              createdAt: instant,
              updatedAt: instant,
            },
          ],
          invoices: [{ issuedAt: instant }],
        })
      ),
      Effect.runPromise
    );

    expect(result?.order.total).toEqual({
      value: 4500,
      exponent: 2,
      currency: "CZK",
    });
    expect(result?.lines[0]?.product).toEqual({
      kind: "goods",
      categoryId: "category-1",
      productId: "product-1",
    });
    expect(result?.paymentAttempts[0]).not.toHaveProperty("providerOrderId");
    expect(result?.invoice).toEqual({
      status: "issued",
      issuedAt: "2026-08-16T12:00:00Z",
    });
  });

  test("writes off an eligible goods order without changing lifecycle state", async () => {
    const { layer, updates } = makeWriteOffLayer(order);
    const result = await Effect.gen(function* () {
      const administration = yield* OrderAdministrationService;
      return yield* administration.writeOffOrder("order-1");
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result.orderId).toBe("order-1");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      writtenOffAt: expect.any(Temporal.Instant),
      updatedAt: expect.any(Temporal.Instant),
    });
    expect(updates[0]).not.toHaveProperty("paymentState");
    expect(updates[0]).not.toHaveProperty("fulfillmentState");
  });

  test("returns the original fact when a write-off is retried after late payment", async () => {
    const writtenOffAt = Temporal.Instant.from("2026-08-16T12:30:00Z");
    const { layer, updates } = makeWriteOffLayer({
      ...order,
      paymentState: "paid",
      paidAt: instant,
      writtenOffAt,
    });
    const result = await Effect.gen(function* () {
      const administration = yield* OrderAdministrationService;
      return yield* administration.writeOffOrder("order-1");
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result.writtenOffAt).toBe(writtenOffAt.toString());
    expect(updates).toEqual([]);
  });

  test("rejects reservations and orders with live payment attempts", async () => {
    const reservation = makeWriteOffLayer({
      ...order,
      kind: "reservation",
    });
    const livePayment = makeWriteOffLayer(order, [{ id: "attempt-1" }]);

    const run = (layer: ReturnType<typeof makeWriteOffLayer>["layer"]) =>
      Effect.gen(function* () {
        const administration = yield* OrderAdministrationService;
        return yield* administration.writeOffOrder("order-1");
      }).pipe(Effect.provide(layer), Effect.flip, Effect.runPromise);

    expect((await run(reservation.layer)).reason).toBe("not_goods");
    expect((await run(livePayment.layer)).reason).toBe("payment_in_progress");
  });
});

const makeWriteOffLayer = (
  selectedOrder: Omit<
    typeof order,
    "kind" | "paidAt" | "paymentState" | "writtenOffAt"
  > & {
    readonly kind: "goods" | "reservation";
    readonly paidAt: Temporal.Instant | null;
    readonly paymentState: "paid" | "pending";
    readonly writtenOffAt: Temporal.Instant | null;
  },
  liveAttempts: readonly { readonly id: string }[] = []
) => {
  const updates: WriteOffUpdate[] = [];
  const query = <A>(rows: readonly A[]) => {
    const result = Effect.succeed(rows);
    return Object.assign(result, {
      from: () => result,
      where: () => result,
      limit: () => result,
      for: () => result,
    });
  };
  const tx = {
    select: (selection?: TestSelection) =>
      selection ? query(liveAttempts) : query([selectedOrder]),
    update: () => ({
      set: (values: WriteOffUpdate) => {
        updates.push(values);
        return {
          where: () => ({
            returning: () => Effect.succeed([{ id: selectedOrder.id }]),
          }),
        };
      },
    }),
  };
  const layer = OrderAdministrationService.Default.pipe(
    Layer.provide(
      Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({
          db: {
            transaction: (operation: (client: never) => unknown) =>
              operation(tx as never),
          } as never,
        })
      )
    )
  );
  return { layer, updates };
};
