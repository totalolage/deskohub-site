import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  invoices,
  orderLines,
  orders,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import type {
  PaymentAttemptState,
  PaymentProvider,
  PaymentRefundState,
} from "@/db/schema/payment-attempts";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceProductIdentity,
  workspaceProductIdentitySchema,
} from "@/features/checkout/product-identity";
import type {
  OrderFulfillmentState,
  OrderId,
  OrderKind,
  OrderLineId,
  OrderPaymentState,
} from "@/features/order";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

const pageSize = 50;

export type AdministrationOrderMoney = {
  readonly value: number;
  readonly exponent: number;
  readonly currency: string;
};

export type AdministrationOrderSummary = {
  readonly id: OrderId;
  readonly kind: OrderKind;
  readonly customerId: DotyposCustomerId;
  readonly paymentState: OrderPaymentState;
  readonly fulfillmentState: OrderFulfillmentState;
  readonly total: AdministrationOrderMoney | null;
  readonly invoiceStatus: "issued" | "not_issued";
  readonly reservationId: WorkspaceReservationId | null;
  readonly paidAt: string | null;
  readonly fulfilledAt: string | null;
  readonly fulfillmentFailedAt: string | null;
  readonly writtenOffAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AdministrationOrderLine = {
  readonly id: OrderLineId;
  readonly sequence: number;
  readonly product: WorkspaceProductIdentity;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: AdministrationOrderMoney;
  readonly undiscountedTotal: AdministrationOrderMoney;
  readonly payableTotal: AdministrationOrderMoney;
  readonly createdAt: string;
};

export type AdministrationOrderPaymentAttempt = {
  readonly id: PaymentAttemptId;
  readonly provider: PaymentProvider;
  readonly state: PaymentAttemptState;
  readonly refundState: PaymentRefundState;
  readonly amount: AdministrationOrderMoney;
  readonly providerOrderCreatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AdministrationOrderDetail = {
  readonly order: AdministrationOrderSummary;
  readonly lines: readonly AdministrationOrderLine[];
  readonly paymentAttempts: readonly AdministrationOrderPaymentAttempt[];
  readonly invoice: {
    readonly status: "issued" | "not_issued";
    readonly issuedAt: string | null;
  };
};

export type AdministrationOrderList = {
  readonly items: readonly AdministrationOrderSummary[];
  readonly truncated: boolean;
};

type SafeOrderRow = {
  readonly id: OrderId;
  readonly kind: OrderKind;
  readonly customerId: DotyposCustomerId;
  readonly paymentState: OrderPaymentState;
  readonly fulfillmentState: OrderFulfillmentState;
  readonly reservationId: WorkspaceReservationId | null;
  readonly paidAt: Temporal.Instant | null;
  readonly fulfilledAt: Temporal.Instant | null;
  readonly fulfillmentFailedAt: Temporal.Instant | null;
  readonly writtenOffAt: Temporal.Instant | null;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
};

type SafeOrderLineRow = {
  readonly id: OrderLineId;
  readonly orderId: OrderId;
  readonly sequence: number;
  readonly productIdentity: unknown;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceValue: number;
  readonly undiscountedTotalValue: number;
  readonly payableTotalValue: number;
  readonly amountExponent: number;
  readonly currency: string;
  readonly createdAt: Temporal.Instant;
};

const safeOrderSelection = {
  id: orders.id,
  kind: orders.kind,
  customerId: orders.dotyposCustomerId,
  paymentState: orders.paymentState,
  fulfillmentState: orders.fulfillmentState,
  reservationId: workspaceReservations.id,
  paidAt: orders.paidAt,
  fulfilledAt: orders.fulfilledAt,
  fulfillmentFailedAt: orders.fulfillmentFailedAt,
  writtenOffAt: orders.writtenOffAt,
  createdAt: orders.createdAt,
  updatedAt: orders.updatedAt,
} as const;

const safeOrderLineSelection = {
  id: orderLines.id,
  orderId: orderLines.orderId,
  sequence: orderLines.sequence,
  productIdentity: orderLines.productIdentity,
  description: orderLines.description,
  quantity: orderLines.quantity,
  unitPriceValue: orderLines.unitPriceValue,
  undiscountedTotalValue: orderLines.undiscountedTotalValue,
  payableTotalValue: orderLines.payableTotalValue,
  amountExponent: orderLines.amountExponent,
  currency: orderLines.currency,
  createdAt: orderLines.createdAt,
} as const;

const safePaymentAttemptSelection = {
  id: paymentAttempts.id,
  provider: paymentAttempts.provider,
  state: paymentAttempts.state,
  refundState: paymentAttempts.refundState,
  amountValue: paymentAttempts.amountValue,
  amountExponent: paymentAttempts.amountExponent,
  currency: paymentAttempts.currency,
  providerOrderCreatedAt: paymentAttempts.providerOrderCreatedAt,
  createdAt: paymentAttempts.createdAt,
  updatedAt: paymentAttempts.updatedAt,
} as const;

const toMoney = (
  value: number,
  exponent: number,
  currency: string
): AdministrationOrderMoney => ({ value, exponent, currency });

const getOrderTotal = (
  lines: readonly SafeOrderLineRow[]
): AdministrationOrderMoney | null => {
  const first = lines[0];
  if (!first) return null;
  if (
    lines.some(
      (line) =>
        line.amountExponent !== first.amountExponent ||
        line.currency !== first.currency
    )
  ) {
    return null;
  }
  return toMoney(
    lines.reduce((total, line) => total + line.payableTotalValue, 0),
    first.amountExponent,
    first.currency
  );
};

const toSummary = (
  row: SafeOrderRow,
  lines: readonly SafeOrderLineRow[],
  invoiceIssued: boolean
): AdministrationOrderSummary => ({
  ...row,
  total: getOrderTotal(lines),
  invoiceStatus: invoiceIssued ? "issued" : "not_issued",
  paidAt: row.paidAt?.toString() ?? null,
  fulfilledAt: row.fulfilledAt?.toString() ?? null,
  fulfillmentFailedAt: row.fulfillmentFailedAt?.toString() ?? null,
  writtenOffAt: row.writtenOffAt?.toString() ?? null,
  createdAt: row.createdAt.toString(),
  updatedAt: row.updatedAt.toString(),
});

const decodeProduct = Schema.decodeUnknownEffect(
  workspaceProductIdentitySchema
);

const toLine = Effect.fn("OrderAdministrationService.toLine")(function* (
  row: SafeOrderLineRow
): Effect.fn.Return<AdministrationOrderLine, Schema.SchemaError> {
  const product = yield* decodeProduct(row.productIdentity);
  return {
    id: row.id,
    sequence: row.sequence,
    product,
    description: row.description,
    quantity: row.quantity,
    unitPrice: toMoney(row.unitPriceValue, row.amountExponent, row.currency),
    undiscountedTotal: toMoney(
      row.undiscountedTotalValue,
      row.amountExponent,
      row.currency
    ),
    payableTotal: toMoney(
      row.payableTotalValue,
      row.amountExponent,
      row.currency
    ),
    createdAt: row.createdAt.toString(),
  };
});

export interface IOrderAdministrationService {
  readonly listOrders: () => Effect.Effect<AdministrationOrderList, unknown>;
  readonly loadOrder: (
    id: OrderId
  ) => Effect.Effect<AdministrationOrderDetail | null, unknown>;
  readonly writeOffOrder: (
    id: OrderId
  ) => Effect.Effect<AdministrationOrderWriteOffResult, unknown>;
}

export type AdministrationOrderWriteOffResult = {
  readonly orderId: OrderId;
  readonly writtenOffAt: string;
};

export class OrderWriteOffError extends Data.TaggedError("OrderWriteOffError")<{
  readonly reason:
    | "not_found"
    | "not_goods"
    | "not_fulfilled"
    | "paid"
    | "payment_in_progress";
  readonly message: string;
}> {}

export class OrderAdministrationService extends Context.Service<
  OrderAdministrationService,
  IOrderAdministrationService
>()("@deskohub-workspace/administration/OrderAdministrationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const listOrders = Effect.fn("OrderAdministrationService.listOrders")(
        function* () {
          const rows = yield* db
            .select(safeOrderSelection)
            .from(orders)
            .leftJoin(
              workspaceReservations,
              eq(workspaceReservations.id, orders.id)
            )
            .orderBy(desc(orders.createdAt), desc(orders.id))
            .limit(pageSize + 1);
          const visibleRows = rows.slice(0, pageSize);
          if (visibleRows.length === 0) {
            return { items: [], truncated: false };
          }
          const orderIds = visibleRows.map((row) => row.id);
          const [lineRows, invoiceRows] = yield* Effect.all(
            [
              db
                .select(safeOrderLineSelection)
                .from(orderLines)
                .where(inArray(orderLines.orderId, orderIds))
                .orderBy(orderLines.orderId, orderLines.sequence),
              db
                .select({ orderId: invoices.orderId })
                .from(invoices)
                .where(inArray(invoices.orderId, orderIds)),
            ],
            { concurrency: "inherit" }
          );
          const linesByOrder = Map.groupBy(lineRows, (line) => line.orderId);
          const invoicedOrders = new Set(
            invoiceRows.flatMap((invoice) =>
              invoice.orderId ? [invoice.orderId] : []
            )
          );
          return {
            items: visibleRows.map((row) =>
              toSummary(
                row,
                linesByOrder.get(row.id) ?? [],
                invoicedOrders.has(row.id)
              )
            ),
            truncated: rows.length > pageSize,
          };
        }
      );

      const loadOrder = Effect.fn("OrderAdministrationService.loadOrder")(
        function* (id: OrderId) {
          const [row] = yield* db
            .select(safeOrderSelection)
            .from(orders)
            .leftJoin(
              workspaceReservations,
              eq(workspaceReservations.id, orders.id)
            )
            .where(eq(orders.id, id))
            .limit(1);
          if (!row) return null;

          const [lineRows, attemptRows, [invoiceRow]] = yield* Effect.all(
            [
              db
                .select(safeOrderLineSelection)
                .from(orderLines)
                .where(eq(orderLines.orderId, id))
                .orderBy(orderLines.sequence),
              db
                .select(safePaymentAttemptSelection)
                .from(paymentAttempts)
                .where(eq(paymentAttempts.orderId, id))
                .orderBy(
                  desc(paymentAttempts.createdAt),
                  desc(paymentAttempts.id)
                ),
              db
                .select({ issuedAt: invoices.issuedAt })
                .from(invoices)
                .where(eq(invoices.orderId, id))
                .limit(1),
            ],
            { concurrency: "inherit" }
          );
          const lines = yield* Effect.all(lineRows.map(toLine), {
            concurrency: "inherit",
          });
          const invoiceStatus = invoiceRow ? "issued" : "not_issued";
          return {
            order: toSummary(row, lineRows, Boolean(invoiceRow)),
            lines,
            paymentAttempts: attemptRows.map((attempt) => ({
              id: attempt.id,
              provider: attempt.provider,
              state: attempt.state,
              refundState: attempt.refundState,
              amount: toMoney(
                attempt.amountValue,
                attempt.amountExponent,
                attempt.currency
              ),
              providerOrderCreatedAt:
                attempt.providerOrderCreatedAt?.toString() ?? null,
              createdAt: attempt.createdAt.toString(),
              updatedAt: attempt.updatedAt.toString(),
            })),
            invoice: {
              status: invoiceStatus,
              issuedAt: invoiceRow?.issuedAt.toString() ?? null,
            },
          } satisfies AdministrationOrderDetail;
        }
      );

      const writeOffOrder = Effect.fn(
        "OrderAdministrationService.writeOffOrder"
      )(function* (id: OrderId) {
        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const [order] = yield* tx
              .select()
              .from(orders)
              .where(eq(orders.id, id))
              .limit(1)
              .for("update");
            if (!order) {
              return yield* new OrderWriteOffError({
                reason: "not_found",
                message: "The order was not found.",
              });
            }
            if (order.kind !== "goods") {
              return yield* new OrderWriteOffError({
                reason: "not_goods",
                message: "Only goods orders can be written off.",
              });
            }
            if (order.writtenOffAt) {
              return {
                orderId: order.id,
                writtenOffAt: order.writtenOffAt.toString(),
              };
            }
            if (order.fulfillmentState !== "fulfilled") {
              return yield* new OrderWriteOffError({
                reason: "not_fulfilled",
                message: "Only fulfilled goods orders can be written off.",
              });
            }
            if (order.paymentState === "paid") {
              return yield* new OrderWriteOffError({
                reason: "paid",
                message: "Paid goods orders cannot be written off.",
              });
            }
            const [liveAttempt] = yield* tx
              .select({ id: paymentAttempts.id })
              .from(paymentAttempts)
              .where(
                and(
                  eq(paymentAttempts.orderId, id),
                  inArray(paymentAttempts.state, ["created", "pending"])
                )
              )
              .limit(1)
              .for("update");
            if (liveAttempt) {
              return yield* new OrderWriteOffError({
                reason: "payment_in_progress",
                message:
                  "An order with a live payment attempt cannot be written off.",
              });
            }
            const writtenOffAt = Temporal.Now.instant();
            const [updated] = yield* tx
              .update(orders)
              .set({ writtenOffAt, updatedAt: writtenOffAt })
              .where(eq(orders.id, id))
              .returning({ id: orders.id });
            if (!updated) {
              return yield* Effect.die("Order write-off returned no row.");
            }
            return {
              orderId: updated.id,
              writtenOffAt: writtenOffAt.toString(),
            };
          })
        );
      });

      return { listOrders, loadOrder, writeOffOrder };
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
