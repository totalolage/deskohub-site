import "server-only";

import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  type MobileShopPurchaseOrderItemRow,
  type MobileShopPurchaseOrderRow,
  mobileShopPurchaseOrderItems,
  mobileShopPurchaseOrders,
} from "@/db/schema/mobile-shop-purchases";
import { instantStringSchema } from "@/shared/utils/temporal";
import type {
  MobileShopCheckoutAttemptKey,
  MobileShopOrderSummary,
  MobileShopPublicReference,
  MobileShopPurchaseId,
  MobileShopQuote,
} from "../contracts";

export class MobileShopPurchaseStateError extends Data.TaggedError(
  "MobileShopPurchaseStateError"
)<{
  readonly operation: string;
  readonly message: string;
}> {}

export interface CreateMobileShopPurchaseInput {
  readonly publicReference: MobileShopPublicReference;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly authorizingDotyposReservationId: DotyposReservationId;
  readonly checkoutAttemptKey: MobileShopCheckoutAttemptKey;
  readonly cartFingerprint: string;
  readonly quote: MobileShopQuote;
}

export type CreateMobileShopPurchaseResult =
  | { readonly kind: "created"; readonly order: MobileShopOrderSummary }
  | { readonly kind: "existing"; readonly order: MobileShopOrderSummary }
  | { readonly kind: "conflict" };

export interface IMobileShopPurchaseRepository {
  readonly create: (
    input: CreateMobileShopPurchaseInput
  ) => Effect.Effect<
    CreateMobileShopPurchaseResult,
    EffectDrizzleQueryError | SqlError | MobileShopPurchaseStateError
  >;
  readonly findOwned: (input: {
    readonly id: MobileShopPurchaseId;
    readonly dotyposCustomerId: DotyposCustomerId;
  }) => Effect.Effect<MobileShopOrderSummary | null, EffectDrizzleQueryError>;
  readonly listOwned: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly before?: Temporal.Instant;
    readonly limit: number;
  }) => Effect.Effect<
    readonly MobileShopOrderSummary[],
    EffectDrizzleQueryError
  >;
}

export class MobileShopPurchaseRepository extends Context.Service<
  MobileShopPurchaseRepository,
  IMobileShopPurchaseRepository
>()("@deskohub-workspace/mobile-shop/MobileShopPurchaseRepository") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const create = Effect.fn("MobileShopPurchaseRepository.create")(
        function* (input: CreateMobileShopPurchaseInput) {
          return yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const [inserted] = yield* tx
                .insert(mobileShopPurchaseOrders)
                .values({
                  publicReference: input.publicReference,
                  dotyposCustomerId: input.dotyposCustomerId,
                  authorizingDotyposReservationId:
                    input.authorizingDotyposReservationId,
                  checkoutAttemptKey: input.checkoutAttemptKey,
                  cartFingerprint: input.cartFingerprint,
                  quoteFingerprint: input.quote.fingerprint,
                  paymentState: "not_started",
                  receiptState: "not_started",
                  stockState: "not_started",
                  totalValue: input.quote.total.value,
                  totalExponent: input.quote.total.exponent,
                  currency: input.quote.total.currency,
                  locale: input.quote.locale,
                  taxRegime: input.quote.taxRegime,
                })
                .onConflictDoNothing({
                  target: mobileShopPurchaseOrders.checkoutAttemptKey,
                })
                .returning();

              if (!inserted) {
                const [existing] = yield* tx
                  .select()
                  .from(mobileShopPurchaseOrders)
                  .where(
                    eq(
                      mobileShopPurchaseOrders.checkoutAttemptKey,
                      input.checkoutAttemptKey
                    )
                  )
                  .limit(1);

                if (!existing) {
                  return yield* new MobileShopPurchaseStateError({
                    operation: "create",
                    message:
                      "The checkout key conflicted but its purchase was unavailable.",
                  });
                }
                if (
                  existing.dotyposCustomerId !== input.dotyposCustomerId ||
                  existing.cartFingerprint !== input.cartFingerprint ||
                  existing.quoteFingerprint !== input.quote.fingerprint
                ) {
                  return { kind: "conflict" as const };
                }

                const items = yield* loadItems(tx, [existing.id]);
                return {
                  kind: "existing" as const,
                  order: toOrderSummary(existing, items.get(existing.id) ?? []),
                };
              }

              yield* tx.insert(mobileShopPurchaseOrderItems).values(
                input.quote.items.map((item) => ({
                  purchaseOrderId: inserted.id,
                  dotyposProductId: item.productId,
                  dotyposCategoryId: item.categoryId,
                  productVersion: item.productVersion,
                  canonicalName: item.canonicalName,
                  displayName: item.displayName,
                  locale: input.quote.locale,
                  quantity: item.quantity,
                  unitLabel: item.unitLabel,
                  unitPriceValue: item.unitPrice.value,
                  lineTotalValue: item.lineTotal.value,
                  amountExponent: item.lineTotal.exponent,
                  currency: item.lineTotal.currency,
                  tax: item.tax,
                }))
              );

              const items = yield* loadItems(tx, [inserted.id]);
              return {
                kind: "created" as const,
                order: toOrderSummary(inserted, items.get(inserted.id) ?? []),
              };
            })
          );
        }
      );

      const findOwned = Effect.fn("MobileShopPurchaseRepository.findOwned")(
        function* (input: {
          readonly id: MobileShopPurchaseId;
          readonly dotyposCustomerId: DotyposCustomerId;
        }) {
          const [order] = yield* db
            .select()
            .from(mobileShopPurchaseOrders)
            .where(
              and(
                eq(mobileShopPurchaseOrders.id, input.id),
                eq(
                  mobileShopPurchaseOrders.dotyposCustomerId,
                  input.dotyposCustomerId
                )
              )
            )
            .limit(1);
          if (!order) return null;

          const items = yield* loadItems(db, [order.id]);
          return toOrderSummary(order, items.get(order.id) ?? []);
        }
      );

      const listOwned = Effect.fn("MobileShopPurchaseRepository.listOwned")(
        function* (input: {
          readonly dotyposCustomerId: DotyposCustomerId;
          readonly before?: Temporal.Instant;
          readonly limit: number;
        }) {
          const limit = Math.max(1, Math.min(50, Math.trunc(input.limit)));
          const orders = yield* db
            .select()
            .from(mobileShopPurchaseOrders)
            .where(
              and(
                eq(
                  mobileShopPurchaseOrders.dotyposCustomerId,
                  input.dotyposCustomerId
                ),
                input.before
                  ? lt(mobileShopPurchaseOrders.createdAt, input.before)
                  : undefined
              )
            )
            .orderBy(desc(mobileShopPurchaseOrders.createdAt))
            .limit(limit);
          const items = yield* loadItems(
            db,
            orders.map((order) => order.id)
          );

          return orders.map((order) =>
            toOrderSummary(order, items.get(order.id) ?? [])
          );
        }
      );

      return {
        create,
        findOwned,
        listOwned,
      } satisfies IMobileShopPurchaseRepository;
    })
  );
}

type TransactionClient = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

type MobileShopReadClient = WorkspaceDatabaseClient | TransactionClient;

const loadItems = Effect.fn("MobileShopPurchaseRepository.loadItems")(
  function* (
    db: MobileShopReadClient,
    orderIds: readonly MobileShopPurchaseId[]
  ) {
    if (orderIds.length === 0) {
      return new Map<
        MobileShopPurchaseId,
        readonly MobileShopPurchaseOrderItemRow[]
      >();
    }
    const rows = yield* db
      .select()
      .from(mobileShopPurchaseOrderItems)
      .where(inArray(mobileShopPurchaseOrderItems.purchaseOrderId, orderIds));
    const grouped = new Map<
      MobileShopPurchaseId,
      MobileShopPurchaseOrderItemRow[]
    >();
    for (const row of rows) {
      const items = grouped.get(row.purchaseOrderId) ?? [];
      items.push(row);
      grouped.set(row.purchaseOrderId, items);
    }
    return grouped;
  }
);

const toOrderSummary = (
  order: MobileShopPurchaseOrderRow,
  items: readonly MobileShopPurchaseOrderItemRow[]
): MobileShopOrderSummary => ({
  id: order.id,
  publicReference: order.publicReference,
  createdAt: instantStringSchema.make(order.createdAt.toString()),
  paymentState: order.paymentState,
  receiptState: order.receiptState,
  locale: order.locale,
  taxRegime: order.taxRegime,
  total: {
    value: order.totalValue,
    exponent: order.totalExponent,
    currency: order.currency,
  },
  items: items.map((item) => ({
    productId: item.dotyposProductId,
    displayName: item.displayName,
    quantity: item.quantity,
    unitPrice: {
      value: item.unitPriceValue,
      exponent: item.amountExponent,
      currency: item.currency,
    },
    lineTotal: {
      value: item.lineTotalValue,
      exponent: item.amountExponent,
      currency: item.currency,
    },
    ...(item.unitLabel && { unitLabel: item.unitLabel }),
    tax: item.tax,
  })),
});
