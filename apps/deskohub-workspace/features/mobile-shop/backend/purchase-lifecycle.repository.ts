import "server-only";

import type {
  DotyposCustomerId,
  DotyposProductId,
  DotyposWarehouseId,
} from "@deskohub/dotypos";
import type {
  NexiOperationId,
  NexiOrderId,
  NexiWebhookEventId,
} from "@deskohub/nexi";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
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
  type MobileShopPurchasePaymentAttemptRow,
  mobileShopPurchaseOrderItems,
  mobileShopPurchaseOrders,
  mobileShopPurchasePaymentAttempts,
  mobileShopPurchaseReceiptDeliveries,
  mobileShopPurchaseStockAttempts,
  mobileShopPurchaseWebhookEvents,
} from "@/db/schema/mobile-shop-purchases";
import type {
  MobileShopPaymentAttemptId,
  MobileShopPurchaseId,
} from "../contracts";

export class MobileShopPurchaseLifecycleStateError extends Data.TaggedError(
  "MobileShopPurchaseLifecycleStateError"
)<{
  readonly operation: string;
  readonly purchaseId?: MobileShopPurchaseId;
  readonly message: string;
}> {}

export type MobileShopPurchaseLifecycleRepositoryError =
  | EffectDrizzleQueryError
  | MobileShopPurchaseLifecycleStateError
  | SqlError;

export interface MobileShopPaymentRecord {
  readonly order: MobileShopPurchaseOrderRow;
  readonly attempt: MobileShopPurchasePaymentAttemptRow;
}

export interface MobileShopFulfillmentRecord {
  readonly order: MobileShopPurchaseOrderRow;
  readonly items: readonly MobileShopPurchaseOrderItemRow[];
}

export type PrepareMobileShopPaymentResult =
  | { readonly kind: "created"; readonly payment: MobileShopPaymentRecord }
  | { readonly kind: "existing"; readonly payment: MobileShopPaymentRecord }
  | { readonly kind: "paid" }
  | { readonly kind: "in_progress" };

export interface MobileShopPaymentTransition {
  readonly changed: boolean;
  readonly additionalPayment: boolean;
  readonly payment: MobileShopPaymentRecord;
  readonly timestamp: Temporal.Instant;
}

export type MobileShopWebhookClaim =
  | { readonly kind: "claimed" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "busy" };

export interface IMobileShopPurchaseLifecycleRepository {
  readonly preparePayment: (input: {
    readonly purchaseId: MobileShopPurchaseId;
    readonly customerId: DotyposCustomerId;
    readonly providerOrderId: NexiOrderId;
  }) => Effect.Effect<
    PrepareMobileShopPaymentResult,
    MobileShopPurchaseLifecycleRepositoryError
  >;
  readonly attachProviderSession: (input: {
    readonly paymentAttemptId: MobileShopPaymentAttemptId;
    readonly securityToken: string;
    readonly providerRedirectUrl: string;
  }) => Effect.Effect<
    MobileShopPaymentRecord,
    MobileShopPurchaseLifecycleRepositoryError
  >;
  readonly markProviderCreationFailed: (input: {
    readonly paymentAttemptId: MobileShopPaymentAttemptId;
    readonly failureCode: string;
  }) => Effect.Effect<void, MobileShopPurchaseLifecycleRepositoryError>;
  readonly findPaymentByProviderOrderId: (
    providerOrderId: NexiOrderId
  ) => Effect.Effect<MobileShopPaymentRecord | null, EffectDrizzleQueryError>;
  readonly findPaymentForOwner: (input: {
    readonly purchaseId: MobileShopPurchaseId;
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<MobileShopPaymentRecord | null, EffectDrizzleQueryError>;
  readonly markPaid: (input: {
    readonly paymentAttemptId: MobileShopPaymentAttemptId;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly providerOperationId?: NexiOperationId;
    readonly providerStatus?: string;
    readonly paidAt: Temporal.Instant;
  }) => Effect.Effect<
    MobileShopPaymentTransition,
    MobileShopPurchaseLifecycleRepositoryError
  >;
  readonly markTerminal: (input: {
    readonly paymentAttemptId: MobileShopPaymentAttemptId;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly providerOperationId?: NexiOperationId;
    readonly providerStatus?: string;
    readonly state: "failed" | "cancelled" | "expired";
    readonly failureCode: string;
  }) => Effect.Effect<
    MobileShopPaymentTransition,
    MobileShopPurchaseLifecycleRepositoryError
  >;
  readonly claimWebhook: (input: {
    readonly eventId: NexiWebhookEventId;
    readonly receivedAt: Temporal.Instant;
  }) => Effect.Effect<MobileShopWebhookClaim, EffectDrizzleQueryError>;
  readonly markWebhookProcessed: (input: {
    readonly eventId: NexiWebhookEventId;
    readonly purchaseId?: MobileShopPurchaseId;
    readonly paymentAttemptId?: MobileShopPaymentAttemptId;
    readonly resultCode: string;
    readonly processedAt: Temporal.Instant;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly markWebhookFailed: (input: {
    readonly eventId: NexiWebhookEventId;
    readonly purchaseId?: MobileShopPurchaseId;
    readonly paymentAttemptId?: MobileShopPaymentAttemptId;
    readonly resultCode: string;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly claimReceipt: (
    purchaseId: MobileShopPurchaseId
  ) => Effect.Effect<
    MobileShopFulfillmentRecord | null,
    MobileShopPurchaseLifecycleRepositoryError
  >;
  readonly markReceiptSent: (input: {
    readonly purchaseId: MobileShopPurchaseId;
    readonly providerMessageId: string;
    readonly sentAt: Temporal.Instant;
  }) => Effect.Effect<void, MobileShopPurchaseLifecycleRepositoryError>;
  readonly markReceiptFailed: (input: {
    readonly purchaseId: MobileShopPurchaseId;
    readonly failureCode: string;
  }) => Effect.Effect<void, MobileShopPurchaseLifecycleRepositoryError>;
  readonly claimStock: (
    purchaseId: MobileShopPurchaseId
  ) => Effect.Effect<
    MobileShopFulfillmentRecord | null,
    MobileShopPurchaseLifecycleRepositoryError
  >;
  readonly markStockSynced: (input: {
    readonly purchaseId: MobileShopPurchaseId;
    readonly warehouseId: DotyposWarehouseId;
    readonly syncedAt: Temporal.Instant;
  }) => Effect.Effect<void, MobileShopPurchaseLifecycleRepositoryError>;
  readonly markStockFailed: (input: {
    readonly purchaseId: MobileShopPurchaseId;
    readonly disposition: "ambiguous" | "definitive";
    readonly failureCode: string;
  }) => Effect.Effect<void, MobileShopPurchaseLifecycleRepositoryError>;
}

export class MobileShopPurchaseLifecycleRepository extends Context.Service<
  MobileShopPurchaseLifecycleRepository,
  IMobileShopPurchaseLifecycleRepository
>()("@deskohub-workspace/mobile-shop/MobileShopPurchaseLifecycleRepository") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return {
        preparePayment: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.preparePayment"
        )(function* (input) {
          return yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const [order] = yield* tx
                .select()
                .from(mobileShopPurchaseOrders)
                .where(
                  and(
                    eq(mobileShopPurchaseOrders.id, input.purchaseId),
                    eq(
                      mobileShopPurchaseOrders.dotyposCustomerId,
                      input.customerId
                    )
                  )
                )
                .limit(1)
                .for("update");
              if (!order) {
                return yield* lifecycleError(
                  "preparePayment",
                  input.purchaseId,
                  "The purchase was not found for its commerce owner."
                );
              }
              if (order.paymentState === "paid") {
                return { kind: "paid" as const };
              }

              if (order.paymentState === "pending") {
                const activeAttempt = order.activePaymentAttemptId
                  ? yield* findAttempt(tx, order.activePaymentAttemptId)
                  : null;
                if (
                  activeAttempt?.state === "pending" &&
                  activeAttempt.providerRedirectUrl &&
                  activeAttempt.securityToken
                ) {
                  return {
                    kind: "existing" as const,
                    payment: { order, attempt: activeAttempt },
                  };
                }
                return { kind: "in_progress" as const };
              }

              const [attempt] = yield* tx
                .insert(mobileShopPurchasePaymentAttempts)
                .values({
                  purchaseOrderId: order.id,
                  providerOrderId: input.providerOrderId,
                  state: "created",
                  amountValue: order.totalValue,
                  amountExponent: order.totalExponent,
                  currency: order.currency,
                })
                .returning();
              if (!attempt) {
                return yield* Effect.die(
                  "Mobile shop payment attempt insert returned no row."
                );
              }

              const now = Temporal.Now.instant();
              const [updatedOrder] = yield* tx
                .update(mobileShopPurchaseOrders)
                .set({
                  activePaymentAttemptId: attempt.id,
                  paymentState: "pending",
                  paymentFailureCode: null,
                  failedAt: null,
                  cancelledAt: null,
                  expiredAt: null,
                  updatedAt: now,
                })
                .where(eq(mobileShopPurchaseOrders.id, order.id))
                .returning();
              if (!updatedOrder) {
                return yield* Effect.die(
                  "Mobile shop purchase payment link returned no row."
                );
              }

              return {
                kind: "created" as const,
                payment: { order: updatedOrder, attempt },
              };
            })
          );
        }),

        attachProviderSession: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.attachProviderSession"
        )(function* (input) {
          return yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const now = Temporal.Now.instant();
              const [attempt] = yield* tx
                .update(mobileShopPurchasePaymentAttempts)
                .set({
                  securityToken: input.securityToken,
                  providerRedirectUrl: input.providerRedirectUrl,
                  providerOrderCreatedAt: now,
                  state: "pending",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(
                      mobileShopPurchasePaymentAttempts.id,
                      input.paymentAttemptId
                    ),
                    eq(mobileShopPurchasePaymentAttempts.state, "created")
                  )
                )
                .returning();
              if (!attempt) {
                return yield* lifecycleError(
                  "attachProviderSession",
                  undefined,
                  "Only a newly created payment attempt can accept a provider session."
                );
              }
              const [order] = yield* tx
                .select()
                .from(mobileShopPurchaseOrders)
                .where(
                  and(
                    eq(mobileShopPurchaseOrders.id, attempt.purchaseOrderId),
                    eq(
                      mobileShopPurchaseOrders.activePaymentAttemptId,
                      attempt.id
                    ),
                    eq(mobileShopPurchaseOrders.paymentState, "pending")
                  )
                )
                .limit(1);
              if (!order) {
                return yield* lifecycleError(
                  "attachProviderSession",
                  attempt.purchaseOrderId,
                  "The payment attempt is no longer active."
                );
              }
              return { order, attempt };
            })
          );
        }),

        markProviderCreationFailed: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.markProviderCreationFailed"
        )(function* (input) {
          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const now = Temporal.Now.instant();
              const [attempt] = yield* tx
                .update(mobileShopPurchasePaymentAttempts)
                .set({
                  state: "failed",
                  failureCode: input.failureCode,
                  lastProviderStatus: "hpp_create_failed",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(
                      mobileShopPurchasePaymentAttempts.id,
                      input.paymentAttemptId
                    ),
                    eq(mobileShopPurchasePaymentAttempts.state, "created")
                  )
                )
                .returning();
              if (!attempt) return;
              yield* tx
                .update(mobileShopPurchaseOrders)
                .set({
                  paymentState: "failed",
                  paymentFailureCode: input.failureCode,
                  failedAt: now,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(mobileShopPurchaseOrders.id, attempt.purchaseOrderId),
                    eq(
                      mobileShopPurchaseOrders.activePaymentAttemptId,
                      attempt.id
                    ),
                    eq(mobileShopPurchaseOrders.paymentState, "pending")
                  )
                );
            })
          );
        }),

        findPaymentByProviderOrderId: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.findPaymentByProviderOrderId"
        )(function* (providerOrderId) {
          const [attempt] = yield* db
            .select()
            .from(mobileShopPurchasePaymentAttempts)
            .where(
              eq(
                mobileShopPurchasePaymentAttempts.providerOrderId,
                providerOrderId
              )
            )
            .limit(1);
          if (!attempt) return null;
          const [order] = yield* db
            .select()
            .from(mobileShopPurchaseOrders)
            .where(eq(mobileShopPurchaseOrders.id, attempt.purchaseOrderId))
            .limit(1);
          return order ? { order, attempt } : null;
        }),

        findPaymentForOwner: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.findPaymentForOwner"
        )(function* (input) {
          const [order] = yield* db
            .select()
            .from(mobileShopPurchaseOrders)
            .where(
              and(
                eq(mobileShopPurchaseOrders.id, input.purchaseId),
                eq(mobileShopPurchaseOrders.dotyposCustomerId, input.customerId)
              )
            )
            .limit(1);
          if (!order?.activePaymentAttemptId) return null;
          const attempt = yield* findAttempt(db, order.activePaymentAttemptId);
          return attempt ? { order, attempt } : null;
        }),

        markPaid: Effect.fn("MobileShopPurchaseLifecycleRepository.markPaid")(
          function* (input) {
            return yield* transitionPayment(db, {
              ...input,
              state: "paid",
            });
          }
        ),

        markTerminal: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.markTerminal"
        )(function* (input) {
          return yield* transitionPayment(db, input);
        }),

        claimWebhook: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.claimWebhook"
        )(function* (input) {
          yield* db
            .insert(mobileShopPurchaseWebhookEvents)
            .values({
              providerEventId: input.eventId,
              state: "received",
              receivedAt: input.receivedAt,
              updatedAt: input.receivedAt,
            })
            .onConflictDoNothing({
              target: mobileShopPurchaseWebhookEvents.providerEventId,
            });

          const staleBefore = input.receivedAt.subtract({ minutes: 1 });
          const [claimed] = yield* db
            .update(mobileShopPurchaseWebhookEvents)
            .set({ state: "processing", updatedAt: input.receivedAt })
            .where(
              and(
                eq(
                  mobileShopPurchaseWebhookEvents.providerEventId,
                  input.eventId
                ),
                or(
                  inArray(mobileShopPurchaseWebhookEvents.state, [
                    "received",
                    "failed",
                  ]),
                  and(
                    eq(mobileShopPurchaseWebhookEvents.state, "processing"),
                    lt(mobileShopPurchaseWebhookEvents.updatedAt, staleBefore)
                  )
                )
              )
            )
            .returning({ id: mobileShopPurchaseWebhookEvents.id });
          if (claimed) return { kind: "claimed" as const };

          const [existing] = yield* db
            .select({ state: mobileShopPurchaseWebhookEvents.state })
            .from(mobileShopPurchaseWebhookEvents)
            .where(
              eq(mobileShopPurchaseWebhookEvents.providerEventId, input.eventId)
            )
            .limit(1);
          return existing?.state === "processed"
            ? { kind: "duplicate" as const }
            : { kind: "busy" as const };
        }),

        markWebhookProcessed: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.markWebhookProcessed"
        )(function* (input) {
          yield* db
            .update(mobileShopPurchaseWebhookEvents)
            .set({
              state: "processed",
              purchaseOrderId: input.purchaseId,
              paymentAttemptId: input.paymentAttemptId,
              resultCode: input.resultCode,
              processedAt: input.processedAt,
              updatedAt: input.processedAt,
            })
            .where(
              eq(mobileShopPurchaseWebhookEvents.providerEventId, input.eventId)
            );
        }),

        markWebhookFailed: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.markWebhookFailed"
        )(function* (input) {
          yield* db
            .update(mobileShopPurchaseWebhookEvents)
            .set({
              state: "failed",
              purchaseOrderId: input.purchaseId,
              paymentAttemptId: input.paymentAttemptId,
              resultCode: input.resultCode,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              eq(mobileShopPurchaseWebhookEvents.providerEventId, input.eventId)
            );
        }),

        claimReceipt: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.claimReceipt"
        )((purchaseId) =>
          claimFulfillment(db, { kind: "receipt", purchaseId })
        ),

        markReceiptSent: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.markReceiptSent"
        )(function* (input) {
          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(mobileShopPurchaseReceiptDeliveries)
                .set({
                  state: "sent",
                  providerMessageId: input.providerMessageId,
                  resultCode: "sent",
                  sentAt: input.sentAt,
                  updatedAt: input.sentAt,
                })
                .where(
                  eq(
                    mobileShopPurchaseReceiptDeliveries.purchaseOrderId,
                    input.purchaseId
                  )
                );
              yield* tx
                .update(mobileShopPurchaseOrders)
                .set({
                  receiptState: "sent",
                  receiptFailureCode: null,
                  receiptSentAt: input.sentAt,
                  updatedAt: input.sentAt,
                })
                .where(
                  and(
                    eq(mobileShopPurchaseOrders.id, input.purchaseId),
                    eq(mobileShopPurchaseOrders.paymentState, "paid")
                  )
                );
            })
          );
        }),

        markReceiptFailed: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.markReceiptFailed"
        )(function* (input) {
          const now = Temporal.Now.instant();
          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(mobileShopPurchaseReceiptDeliveries)
                .set({
                  state: "failed",
                  resultCode: input.failureCode,
                  updatedAt: now,
                })
                .where(
                  eq(
                    mobileShopPurchaseReceiptDeliveries.purchaseOrderId,
                    input.purchaseId
                  )
                );
              yield* tx
                .update(mobileShopPurchaseOrders)
                .set({
                  receiptState: "failed",
                  receiptFailureCode: input.failureCode,
                  updatedAt: now,
                })
                .where(eq(mobileShopPurchaseOrders.id, input.purchaseId));
            })
          );
        }),

        claimStock: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.claimStock"
        )((purchaseId) => claimFulfillment(db, { kind: "stock", purchaseId })),

        markStockSynced: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.markStockSynced"
        )(function* (input) {
          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(mobileShopPurchaseStockAttempts)
                .set({
                  state: "synced",
                  warehouseId: input.warehouseId,
                  resultCode: "synced",
                  retryAllowed: false,
                  syncedAt: input.syncedAt,
                  updatedAt: input.syncedAt,
                })
                .where(
                  eq(
                    mobileShopPurchaseStockAttempts.purchaseOrderId,
                    input.purchaseId
                  )
                );
              yield* tx
                .update(mobileShopPurchaseOrders)
                .set({
                  stockState: "synced",
                  stockRetryAllowed: false,
                  stockFailureCode: null,
                  stockSyncedAt: input.syncedAt,
                  updatedAt: input.syncedAt,
                })
                .where(
                  and(
                    eq(mobileShopPurchaseOrders.id, input.purchaseId),
                    eq(mobileShopPurchaseOrders.paymentState, "paid")
                  )
                );
            })
          );
        }),

        markStockFailed: Effect.fn(
          "MobileShopPurchaseLifecycleRepository.markStockFailed"
        )(function* (input) {
          const now = Temporal.Now.instant();
          const state =
            input.disposition === "ambiguous" ? "ambiguous" : "failed";
          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(mobileShopPurchaseStockAttempts)
                .set({
                  state,
                  resultCode: input.failureCode,
                  retryAllowed: false,
                  updatedAt: now,
                })
                .where(
                  eq(
                    mobileShopPurchaseStockAttempts.purchaseOrderId,
                    input.purchaseId
                  )
                );
              yield* tx
                .update(mobileShopPurchaseOrders)
                .set({
                  stockState: state,
                  stockRetryAllowed: false,
                  stockFailureCode: input.failureCode,
                  updatedAt: now,
                })
                .where(eq(mobileShopPurchaseOrders.id, input.purchaseId));
            })
          );
        }),
      } satisfies IMobileShopPurchaseLifecycleRepository;
    })
  );
}

type TransactionClient = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

type MobileShopWriteClient = WorkspaceDatabaseClient | TransactionClient;

const lifecycleError = (
  operation: string,
  purchaseId: MobileShopPurchaseId | undefined,
  message: string
) =>
  new MobileShopPurchaseLifecycleStateError({
    operation,
    ...(purchaseId && { purchaseId }),
    message,
  });

const findAttempt = Effect.fn(
  "MobileShopPurchaseLifecycleRepository.findAttempt"
)(function* (
  db: MobileShopWriteClient,
  paymentAttemptId: MobileShopPaymentAttemptId
) {
  const [attempt] = yield* db
    .select()
    .from(mobileShopPurchasePaymentAttempts)
    .where(eq(mobileShopPurchasePaymentAttempts.id, paymentAttemptId))
    .limit(1);
  return attempt ?? null;
});

const transitionPayment = Effect.fn(
  "MobileShopPurchaseLifecycleRepository.transitionPayment"
)(function* (
  db: WorkspaceDatabaseClient,
  input: {
    readonly paymentAttemptId: MobileShopPaymentAttemptId;
    readonly webhookEventId?: NexiWebhookEventId;
    readonly providerOperationId?: NexiOperationId;
    readonly providerStatus?: string;
    readonly state: "paid" | "failed" | "cancelled" | "expired";
    readonly failureCode?: string;
    readonly paidAt?: Temporal.Instant;
  }
) {
  return yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const [attempt] = yield* tx
        .select()
        .from(mobileShopPurchasePaymentAttempts)
        .where(eq(mobileShopPurchasePaymentAttempts.id, input.paymentAttemptId))
        .limit(1)
        .for("update");
      if (!attempt) {
        return yield* lifecycleError(
          "transitionPayment",
          undefined,
          "The payment attempt was not found."
        );
      }
      const [order] = yield* tx
        .select()
        .from(mobileShopPurchaseOrders)
        .where(eq(mobileShopPurchaseOrders.id, attempt.purchaseOrderId))
        .limit(1)
        .for("update");
      if (!order) {
        return yield* lifecycleError(
          "transitionPayment",
          attempt.purchaseOrderId,
          "The purchase was not found."
        );
      }

      const timestamp = input.paidAt ?? Temporal.Now.instant();
      if (attempt.state === input.state && order.paymentState === input.state) {
        return {
          changed: false,
          additionalPayment: false,
          payment: { order, attempt },
          timestamp,
        };
      }
      if (input.state === "paid" && order.paymentState === "paid") {
        const [updatedAttempt] = yield* tx
          .update(mobileShopPurchasePaymentAttempts)
          .set({
            state: "paid",
            failureCode: null,
            lastWebhookEventId: input.webhookEventId,
            lastProviderOperationId: input.providerOperationId,
            lastProviderStatus: input.providerStatus,
            updatedAt: timestamp,
          })
          .where(eq(mobileShopPurchasePaymentAttempts.id, attempt.id))
          .returning();
        if (!updatedAttempt) {
          return yield* Effect.die(
            "Additional mobile shop payment transition returned no row."
          );
        }
        return {
          changed: false,
          additionalPayment: true,
          payment: { order, attempt: updatedAttempt },
          timestamp,
        };
      }
      const mayBecomePaid =
        input.state === "paid" &&
        ["created", "pending", "failed", "cancelled", "expired"].includes(
          attempt.state
        ) &&
        ["pending", "failed", "cancelled", "expired"].includes(
          order.paymentState
        );
      const mayBecomeTerminal =
        input.state !== "paid" &&
        ["created", "pending"].includes(attempt.state) &&
        order.paymentState === "pending";
      if (
        attempt.state === "paid" ||
        order.paymentState === "paid" ||
        (input.state !== "paid" &&
          order.activePaymentAttemptId !== attempt.id) ||
        (!mayBecomePaid && !mayBecomeTerminal)
      ) {
        return yield* lifecycleError(
          "transitionPayment",
          order.id,
          "The payment attempt cannot make the requested transition."
        );
      }

      const failureCode = input.state === "paid" ? null : input.failureCode;
      const [updatedAttempt] = yield* tx
        .update(mobileShopPurchasePaymentAttempts)
        .set({
          state: input.state,
          failureCode,
          lastWebhookEventId: input.webhookEventId,
          lastProviderOperationId: input.providerOperationId,
          lastProviderStatus: input.providerStatus,
          updatedAt: timestamp,
        })
        .where(eq(mobileShopPurchasePaymentAttempts.id, attempt.id))
        .returning();
      const terminalTimestamp = input.state === "paid" ? null : timestamp;
      const [updatedOrder] = yield* tx
        .update(mobileShopPurchaseOrders)
        .set({
          paymentState: input.state,
          activePaymentAttemptId:
            input.state === "paid" ? attempt.id : order.activePaymentAttemptId,
          paymentFailureCode: failureCode,
          paidAt: input.state === "paid" ? timestamp : null,
          failedAt: input.state === "failed" ? terminalTimestamp : null,
          cancelledAt: input.state === "cancelled" ? terminalTimestamp : null,
          expiredAt: input.state === "expired" ? terminalTimestamp : null,
          updatedAt: timestamp,
        })
        .where(eq(mobileShopPurchaseOrders.id, order.id))
        .returning();
      if (!updatedAttempt || !updatedOrder) {
        return yield* Effect.die(
          "Mobile shop payment transition returned no row."
        );
      }
      return {
        changed: true,
        additionalPayment: false,
        payment: { order: updatedOrder, attempt: updatedAttempt },
        timestamp,
      };
    })
  );
});

const claimFulfillment = Effect.fn(
  "MobileShopPurchaseLifecycleRepository.claimFulfillment"
)(function* (
  db: WorkspaceDatabaseClient,
  input: {
    readonly kind: "receipt" | "stock";
    readonly purchaseId: MobileShopPurchaseId;
  }
) {
  return yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const [order] = yield* tx
        .select()
        .from(mobileShopPurchaseOrders)
        .where(eq(mobileShopPurchaseOrders.id, input.purchaseId))
        .limit(1)
        .for("update");
      if (!order || order.paymentState !== "paid") return null;

      const now = Temporal.Now.instant();
      const claimed =
        input.kind === "receipt"
          ? yield* claimReceiptDelivery(tx, order, now)
          : yield* claimStockAttempt(tx, order, now);
      if (!claimed) return null;

      const items = yield* tx
        .select()
        .from(mobileShopPurchaseOrderItems)
        .where(
          eq(mobileShopPurchaseOrderItems.purchaseOrderId, input.purchaseId)
        );
      return { order, items };
    })
  );
});

const claimReceiptDelivery = Effect.fn(
  "MobileShopPurchaseLifecycleRepository.claimReceiptDelivery"
)(function* (
  tx: TransactionClient,
  order: MobileShopPurchaseOrderRow,
  now: Temporal.Instant
) {
  const [inserted] = yield* tx
    .insert(mobileShopPurchaseReceiptDeliveries)
    .values({
      purchaseOrderId: order.id,
      idempotencyKey: `mobile-shop-receipt:${order.id}`,
      state: "processing",
      attemptCount: 1,
      lastAttemptAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: mobileShopPurchaseReceiptDeliveries.purchaseOrderId,
    })
    .returning({
      purchaseOrderId: mobileShopPurchaseReceiptDeliveries.purchaseOrderId,
    });

  const [retried] = inserted
    ? []
    : yield* tx
        .update(mobileShopPurchaseReceiptDeliveries)
        .set({
          state: "processing",
          resultCode: null,
          attemptCount: sql`${mobileShopPurchaseReceiptDeliveries.attemptCount} + 1`,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(mobileShopPurchaseReceiptDeliveries.purchaseOrderId, order.id),
            eq(mobileShopPurchaseReceiptDeliveries.state, "failed")
          )
        )
        .returning({
          purchaseOrderId: mobileShopPurchaseReceiptDeliveries.purchaseOrderId,
        });
  if (!inserted && !retried) return false;

  yield* tx
    .update(mobileShopPurchaseOrders)
    .set({
      receiptState: "processing",
      receiptFailureCode: null,
      updatedAt: now,
    })
    .where(eq(mobileShopPurchaseOrders.id, order.id));
  return true;
});

const claimStockAttempt = Effect.fn(
  "MobileShopPurchaseLifecycleRepository.claimStockAttempt"
)(function* (
  tx: TransactionClient,
  order: MobileShopPurchaseOrderRow,
  now: Temporal.Instant
) {
  const [inserted] = yield* tx
    .insert(mobileShopPurchaseStockAttempts)
    .values({
      purchaseOrderId: order.id,
      state: "processing",
      attemptCount: 1,
      lastAttemptAt: now,
      retryAllowed: false,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: mobileShopPurchaseStockAttempts.purchaseOrderId,
    })
    .returning({
      purchaseOrderId: mobileShopPurchaseStockAttempts.purchaseOrderId,
    });
  if (!inserted) return false;

  yield* tx
    .update(mobileShopPurchaseOrders)
    .set({
      stockState: "processing",
      stockRetryAllowed: false,
      stockFailureCode: null,
      updatedAt: now,
    })
    .where(eq(mobileShopPurchaseOrders.id, order.id));
  return true;
});

export const toStockItems = (
  items: readonly MobileShopPurchaseOrderItemRow[]
): readonly {
  readonly productId: DotyposProductId;
  readonly quantity: number;
}[] =>
  items.map((item) => ({
    productId: item.dotyposProductId,
    quantity: item.quantity,
  }));
