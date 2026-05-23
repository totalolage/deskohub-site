import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import {
  type DatabaseError,
  hasErrorTag,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import { type PaymentOrder, paymentOrders } from "@/db/schema";
import { checkoutDetailsJsonSchema } from "@/features/checkout/schemas/checkout-details";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";

type PaymentOrderCheckoutDetailsCreateInput = Omit<
  CheckoutDetailsJson,
  "fulfillment"
>;

const workspacePaymentOrderAccessCodePolicy = "workspace-static-v1" as const;

export class PaymentOrderStateError extends Data.TaggedError(
  "PaymentOrderStateError"
)<{
  readonly operation: string;
  readonly orderId: string;
  readonly message: string;
}> {
  get code() {
    return "PAYMENT_ORDER_STATE_ERROR";
  }
}

export type UnsuccessfulTerminalPaymentStatus =
  | "payment_failed"
  | "cancelled"
  | "expired";

export interface PaymentTerminalInput {
  readonly id: string;
  readonly status: UnsuccessfulTerminalPaymentStatus;
  readonly failureCode: string;
  readonly providerOperationId?: string;
  readonly providerStatus?: string;
  readonly webhookEventId?: string;
}

export interface PaymentOrderRepository {
  readonly create: (input: {
    readonly id: string;
    readonly dotyposCustomerId: string;
    readonly correlationId: string;
    readonly checkoutDetails: PaymentOrderCheckoutDetailsCreateInput;
  }) => Effect.Effect<PaymentOrder, DatabaseError>;
  readonly attachNexiSession: (input: {
    readonly id: string;
    readonly securityToken: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly findById: (
    id: string
  ) => Effect.Effect<PaymentOrder | null, DatabaseError>;
  readonly markPaymentPending: (
    id: string
  ) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly markPaid: (input: {
    readonly id: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
    readonly webhookEventId?: string;
    readonly paidAt: Date;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly markFailed: (input: {
    readonly id: string;
    readonly failureCode: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
    readonly webhookEventId?: string;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly markCancelled: (input: {
    readonly id: string;
    readonly failureCode: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
    readonly webhookEventId?: string;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly markExpired: (input: {
    readonly id: string;
    readonly failureCode: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
    readonly webhookEventId?: string;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly markUnsuccessfulTerminal: (
    input: PaymentTerminalInput
  ) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly attachDotyposReservation: (input: {
    readonly id: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Date;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly markCustomerAccessEmailSent: (input: {
    readonly id: string;
    readonly sentAt: Date;
  }) => Effect.Effect<boolean, DatabaseError>;
  readonly markInternalNotificationSent: (input: {
    readonly id: string;
    readonly sentAt: Date;
  }) => Effect.Effect<boolean, DatabaseError>;
  readonly markFulfilled: (input: {
    readonly id: string;
    readonly fulfilledAt: Date;
  }) => Effect.Effect<boolean, DatabaseError | PaymentOrderStateError>;
  readonly markFulfillmentFailed: (input: {
    readonly id: string;
    readonly failureCode: string;
    readonly failedAt: Date;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
}

export const PaymentOrderRepository =
  Context.GenericTag<PaymentOrderRepository>("PaymentOrderRepository");

const ensureUpdated = (
  updated: readonly Pick<PaymentOrder, "id">[],
  operation: string,
  orderId: string,
  message: string
) =>
  updated.length > 0
    ? Effect.void
    : Effect.fail(new PaymentOrderStateError({ operation, orderId, message }));

const isPaymentOrderStateError = (
  cause: unknown
): cause is PaymentOrderStateError =>
  hasErrorTag("PaymentOrderStateError")(cause);

const optionalMatches = (current: string | null, next: string | undefined) =>
  next === undefined || current === null || current === next;

const paidProviderResultMatches = (
  order: PaymentOrder,
  input: {
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
    readonly webhookEventId?: string;
  }
) =>
  optionalMatches(order.lastProviderOperationId, input.providerOperationId) &&
  optionalMatches(order.lastProviderStatus, input.providerStatus) &&
  optionalMatches(order.lastWebhookEventId, input.webhookEventId);

const terminalResultMatches = (
  order: PaymentOrder,
  input: PaymentTerminalInput
) =>
  order.paymentStatus === input.status &&
  order.failureCode === input.failureCode &&
  optionalMatches(order.lastProviderOperationId, input.providerOperationId) &&
  optionalMatches(order.lastProviderStatus, input.providerStatus) &&
  optionalMatches(order.lastWebhookEventId, input.webhookEventId);

export const PaymentOrderRepositoryLive = Layer.effect(
  PaymentOrderRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    const findById = (id: string) =>
      runDb("paymentOrders.findById", async () => {
        const [order] = await db
          .select()
          .from(paymentOrders)
          .where(eq(paymentOrders.id, id))
          .limit(1);
        return order ?? null;
      });

    const markUnsuccessfulTerminal = (input: PaymentTerminalInput) =>
      runDb<void, PaymentOrderStateError>(
        "paymentOrders.markUnsuccessfulTerminal",
        async () => {
          await db.transaction(async (tx) => {
            const [order] = await tx
              .select()
              .from(paymentOrders)
              .where(eq(paymentOrders.id, input.id))
              .limit(1)
              .for("update");

            if (!order) {
              throw new PaymentOrderStateError({
                operation: "paymentOrders.markUnsuccessfulTerminal",
                orderId: input.id,
                message: "Payment order was not found",
              });
            }

            if (order.paymentStatus === input.status) {
              if (!terminalResultMatches(order, input)) {
                throw new PaymentOrderStateError({
                  operation: "paymentOrders.markUnsuccessfulTerminal",
                  orderId: input.id,
                  message:
                    "Terminal payment state cannot be overwritten with a conflicting provider result",
                });
              }

              return;
            }

            if (!["created", "payment_pending"].includes(order.paymentStatus)) {
              throw new PaymentOrderStateError({
                operation: "paymentOrders.markUnsuccessfulTerminal",
                orderId: input.id,
                message:
                  "Paid or already-terminal orders cannot transition to a different unsuccessful terminal state",
              });
            }

            await tx
              .update(paymentOrders)
              .set({
                paymentStatus: input.status,
                failureCode: input.failureCode,
                lastWebhookEventId: input.webhookEventId,
                lastProviderOperationId: input.providerOperationId,
                lastProviderStatus: input.providerStatus,
                updatedAt: new Date(),
              })
              .where(eq(paymentOrders.id, input.id));
          });
        },
        { preserveError: isPaymentOrderStateError }
      );

    return PaymentOrderRepository.of({
      create: (input) =>
        runDb("paymentOrders.create", async () => {
          const checkoutDetails = checkoutDetailsJsonSchema.parse({
            ...input.checkoutDetails,
            fulfillment: {
              accessCodePolicy: workspacePaymentOrderAccessCodePolicy,
            },
          });
          const [order] = await db
            .insert(paymentOrders)
            .values({
              id: input.id,
              provider: "nexi",
              dotyposCustomerId: input.dotyposCustomerId,
              correlationId: input.correlationId,
              checkoutDetails,
              paymentStatus: "created",
              fulfillmentStatus: "not_started",
            })
            .returning();

          if (!order) {
            throw new Error("Payment order insert returned no row");
          }

          return order;
        }),

      attachNexiSession: (input) =>
        Effect.gen(function* () {
          const updated = yield* runDb("paymentOrders.attachNexiSession", () =>
            db
              .update(paymentOrders)
              .set({
                securityToken: input.securityToken,
                lastProviderOperationId: input.providerOperationId,
                lastProviderStatus: input.providerStatus,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(paymentOrders.id, input.id),
                  or(
                    isNull(paymentOrders.securityToken),
                    eq(paymentOrders.securityToken, input.securityToken)
                  )
                )
              )
              .returning({ id: paymentOrders.id })
          );

          yield* ensureUpdated(
            updated,
            "paymentOrders.attachNexiSession",
            input.id,
            "Order was not found or already has a different Nexi security token"
          );
        }),

      findById,

      markPaymentPending: (id) =>
        Effect.gen(function* () {
          const updated = yield* runDb("paymentOrders.markPaymentPending", () =>
            db
              .update(paymentOrders)
              .set({ paymentStatus: "payment_pending", updatedAt: new Date() })
              .where(
                and(
                  eq(paymentOrders.id, id),
                  inArray(paymentOrders.paymentStatus, [
                    "created",
                    "payment_pending",
                  ])
                )
              )
              .returning({ id: paymentOrders.id })
          );

          yield* ensureUpdated(
            updated,
            "paymentOrders.markPaymentPending",
            id,
            "Only created or already-pending orders can be marked pending"
          );
        }),

      markPaid: (input) =>
        runDb<void, PaymentOrderStateError>(
          "paymentOrders.markPaid",
          async () => {
            await db.transaction(async (tx) => {
              const [order] = await tx
                .select()
                .from(paymentOrders)
                .where(eq(paymentOrders.id, input.id))
                .limit(1)
                .for("update");

              if (!order) {
                throw new PaymentOrderStateError({
                  operation: "paymentOrders.markPaid",
                  orderId: input.id,
                  message: "Payment order was not found",
                });
              }

              if (order.paymentStatus === "paid") {
                if (!paidProviderResultMatches(order, input)) {
                  throw new PaymentOrderStateError({
                    operation: "paymentOrders.markPaid",
                    orderId: input.id,
                    message:
                      "Already-paid order cannot be overwritten with a conflicting provider result",
                  });
                }

                return;
              }

              if (
                !["created", "payment_pending"].includes(order.paymentStatus)
              ) {
                throw new PaymentOrderStateError({
                  operation: "paymentOrders.markPaid",
                  orderId: input.id,
                  message:
                    "Failed, cancelled, or expired orders cannot be marked paid",
                });
              }

              await tx
                .update(paymentOrders)
                .set({
                  paymentStatus: "paid",
                  paidAt: input.paidAt,
                  lastWebhookEventId: input.webhookEventId,
                  lastProviderOperationId: input.providerOperationId,
                  lastProviderStatus: input.providerStatus,
                  failureCode: null,
                  updatedAt: new Date(),
                })
                .where(eq(paymentOrders.id, input.id));
            });
          },
          { preserveError: isPaymentOrderStateError }
        ),

      markFailed: (input) =>
        markUnsuccessfulTerminal({
          ...input,
          status: "payment_failed",
        }),

      markCancelled: (input) =>
        markUnsuccessfulTerminal({
          ...input,
          status: "cancelled",
        }),

      markExpired: (input) =>
        markUnsuccessfulTerminal({
          ...input,
          status: "expired",
        }),

      markUnsuccessfulTerminal,

      attachDotyposReservation: (input) =>
        Effect.gen(function* () {
          const updated = yield* runDb(
            "paymentOrders.attachDotyposReservation",
            () =>
              db
                .update(paymentOrders)
                .set({
                  dotyposReservationId: input.dotyposReservationId,
                  reservationCreatedAt: input.reservationCreatedAt,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    eq(paymentOrders.paymentStatus, "paid"),
                    or(
                      isNull(paymentOrders.dotyposReservationId),
                      eq(
                        paymentOrders.dotyposReservationId,
                        input.dotyposReservationId
                      )
                    )
                  )
                )
                .returning({ id: paymentOrders.id })
          );

          yield* ensureUpdated(
            updated,
            "paymentOrders.attachDotyposReservation",
            input.id,
            "Reservation can only be attached to paid orders and cannot overwrite a different reservation"
          );
        }),

      markCustomerAccessEmailSent: (input) =>
        runDb("paymentOrders.markCustomerAccessEmailSent", async () => {
          const updated = await db
            .update(paymentOrders)
            .set({
              customerAccessEmailSentAt: input.sentAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(paymentOrders.id, input.id),
                isNull(paymentOrders.customerAccessEmailSentAt)
              )
            )
            .returning({ id: paymentOrders.id });
          return updated.length > 0;
        }),

      markInternalNotificationSent: (input) =>
        runDb("paymentOrders.markInternalNotificationSent", async () => {
          const updated = await db
            .update(paymentOrders)
            .set({
              internalNotificationSentAt: input.sentAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(paymentOrders.id, input.id),
                isNull(paymentOrders.internalNotificationSentAt)
              )
            )
            .returning({ id: paymentOrders.id });
          return updated.length > 0;
        }),

      markFulfilled: (input) =>
        Effect.gen(function* () {
          const updated = yield* runDb("paymentOrders.markFulfilled", () =>
            db
              .update(paymentOrders)
              .set({
                fulfillmentStatus: "fulfilled",
                fulfilledAt: input.fulfilledAt,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(paymentOrders.id, input.id),
                  eq(paymentOrders.paymentStatus, "paid"),
                  inArray(paymentOrders.fulfillmentStatus, [
                    "not_started",
                    "failed",
                  ]),
                  isNotNull(paymentOrders.dotyposReservationId),
                  isNotNull(paymentOrders.customerAccessEmailSentAt),
                  isNotNull(paymentOrders.internalNotificationSentAt)
                )
              )
              .returning({ id: paymentOrders.id })
          );

          if (updated.length > 0) {
            return true;
          }

          const order = yield* findById(input.id);
          if (!order) {
            return false;
          }

          if (order.fulfillmentStatus === "fulfilled") {
            return false;
          }

          return yield* Effect.fail(
            new PaymentOrderStateError({
              operation: "paymentOrders.markFulfilled",
              orderId: input.id,
              message:
                "Order must be paid and have reservation plus both notification timestamps before fulfillment can complete",
            })
          );
        }),

      markFulfillmentFailed: (input) =>
        Effect.gen(function* () {
          const updated = yield* runDb(
            "paymentOrders.markFulfillmentFailed",
            () =>
              db
                .update(paymentOrders)
                .set({
                  fulfillmentStatus: "failed",
                  fulfillmentFailedAt: input.failedAt,
                  fulfillmentFailureCode: input.failureCode,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    eq(paymentOrders.paymentStatus, "paid")
                  )
                )
                .returning({ id: paymentOrders.id })
          );

          yield* ensureUpdated(
            updated,
            "paymentOrders.markFulfillmentFailed",
            input.id,
            "Only paid orders can enter fulfillment failure state"
          );
        }),
    });
  })
);
