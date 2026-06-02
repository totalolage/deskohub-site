import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import {
  type DatabaseError,
  hasErrorTag,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import { type PaymentOrder, paymentOrders } from "@/db/schema";
import {
  checkoutDetailsJsonSchema,
  mergeLegalEvidenceMaps,
} from "@/features/checkout/schemas/checkout-details";
import type { LegalEvidenceMap } from "@/features/checkout/types/checkout-details";
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
}> {}

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
    readonly reservationSubmitKey?: string;
    readonly reservationHoldExpiresAt?: Date;
  }) => Effect.Effect<PaymentOrder, DatabaseError>;
  readonly findByReservationSubmitKey: (
    reservationSubmitKey: string
  ) => Effect.Effect<PaymentOrder | null, DatabaseError>;
  readonly mergeLegalEvidence: (input: {
    readonly id: string;
    readonly legalEvidence: LegalEvidenceMap;
  }) => Effect.Effect<PaymentOrder, DatabaseError | PaymentOrderStateError>;
  readonly updateCheckoutDetails: (input: {
    readonly id: string;
    readonly checkoutDetails: PaymentOrderCheckoutDetailsCreateInput;
  }) => Effect.Effect<PaymentOrder, DatabaseError | PaymentOrderStateError>;
  readonly deleteUnassociatedCreated: (
    id: string
  ) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly attachNexiSession: (input: {
    readonly id: string;
    readonly securityToken: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
    readonly providerRedirectUrl?: string;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly claimNexiSessionCreation: (
    id: string
  ) => Effect.Effect<boolean, DatabaseError>;
  readonly findById: (
    id: string
  ) => Effect.Effect<PaymentOrder | null, DatabaseError>;
  readonly markPaymentPending: (
    id: string
  ) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly resetUnsuccessfulForRetry: (input: {
    readonly id: string;
    readonly correlationId: string;
    readonly checkoutDetails: PaymentOrderCheckoutDetailsCreateInput;
  }) => Effect.Effect<PaymentOrder, DatabaseError | PaymentOrderStateError>;
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
  readonly claimReservationCreation: (
    id: string
  ) => Effect.Effect<boolean, DatabaseError>;
  readonly releaseReservationCreation: (
    id: string
  ) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly attachNewReservationHold: (input: {
    readonly id: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Date;
    readonly reservationHoldExpiresAt?: Date;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly markReservationAttachCancellationPending: (input: {
    readonly id: string;
    readonly dotyposReservationId: string;
    readonly reservationCreatedAt: Date;
    readonly failureCode: string;
    readonly failureMessage: string;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly claimReservationCancellation: (
    id: string
  ) => Effect.Effect<PaymentOrder | null, DatabaseError>;
  readonly markReservationCancelled: (input: {
    readonly id: string;
    readonly cancelledAt: Date;
    readonly holdExpiredAt?: Date;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly markReservationCancellationFailed: (input: {
    readonly id: string;
    readonly failureCode: string;
    readonly failureMessage: string;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly markReservationConfirmed: (input: {
    readonly id: string;
    readonly confirmedAt: Date;
  }) => Effect.Effect<void, DatabaseError | PaymentOrderStateError>;
  readonly selectExpiredReservationHolds: (input: {
    readonly now: Date;
    readonly limit: number;
  }) => Effect.Effect<readonly PaymentOrder[], DatabaseError>;
  readonly claimPaidFulfillment: (
    id: string
  ) => Effect.Effect<PaymentOrder | null, DatabaseError>;
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

    const findById: (
      id: string
    ) => Effect.Effect<PaymentOrder | null, DatabaseError> = Effect.fn(
      "paymentOrders.findById"
    )(
      function* (id) {
        return yield* runDb("paymentOrders.findById", async () => {
          const [order] = await db
            .select()
            .from(paymentOrders)
            .where(eq(paymentOrders.id, id))
            .limit(1);
          return order ?? null;
        });
      },
      (effect, orderId) => effect.pipe(Effect.annotateLogs({ orderId }))
    );

    const findByReservationSubmitKey: (
      reservationSubmitKey: string
    ) => Effect.Effect<PaymentOrder | null, DatabaseError> = Effect.fn(
      "paymentOrders.findByReservationSubmitKey"
    )(
      function* (reservationSubmitKey) {
        return yield* runDb(
          "paymentOrders.findByReservationSubmitKey",
          async () => {
            const [order] = await db
              .select()
              .from(paymentOrders)
              .where(eq(paymentOrders.reservationSubmitKey, reservationSubmitKey))
              .limit(1);
            return order ?? null;
          }
        );
      },
      (effect, reservationSubmitKey) =>
        effect.pipe(Effect.annotateLogs({ reservationSubmitKey }))
    );

    const markUnsuccessfulTerminal: (
      input: PaymentTerminalInput
    ) => Effect.Effect<void, DatabaseError | PaymentOrderStateError> =
      Effect.fn("paymentOrders.markUnsuccessfulTerminal")(
        function* (input) {
          return yield* runDb<void, PaymentOrderStateError>(
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

                if (
                  !["created", "payment_pending"].includes(order.paymentStatus)
                ) {
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
                  })
                  .where(eq(paymentOrders.id, input.id));
              });
            },
            { preserveError: isPaymentOrderStateError }
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
      );

    return PaymentOrderRepository.of({
      create: Effect.fn("paymentOrders.create")(
        function* (input) {
          return yield* runDb("paymentOrders.create", async () => {
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
                reservationSubmitKey: input.reservationSubmitKey,
                reservationHoldExpiresAt: input.reservationHoldExpiresAt,
              })
              .onConflictDoNothing()
              .returning();

            if (!order) {
              const [existingOrder] = await db
                .select()
                .from(paymentOrders)
                .where(
                  input.reservationSubmitKey
                    ? or(
                        eq(paymentOrders.id, input.id),
                        eq(
                          paymentOrders.reservationSubmitKey,
                          input.reservationSubmitKey
                        )
                      )
                    : eq(paymentOrders.id, input.id)
                )
                .limit(1);

              if (!existingOrder) throw new Error("Payment order insert returned no row");

              return existingOrder;
            }

            return order;
          });
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      findByReservationSubmitKey,

      mergeLegalEvidence: Effect.fn("paymentOrders.mergeLegalEvidence")(
        function* (input) {
          return yield* runDb<PaymentOrder, PaymentOrderStateError>(
            "paymentOrders.mergeLegalEvidence",
            async () => {
              return await db.transaction(async (tx) => {
                const [order] = await tx
                  .select()
                  .from(paymentOrders)
                  .where(eq(paymentOrders.id, input.id))
                  .limit(1)
                  .for("update");

                if (!order) {
                  throw new PaymentOrderStateError({
                    operation: "paymentOrders.mergeLegalEvidence",
                    orderId: input.id,
                    message: "Payment order was not found",
                  });
                }

                const mergedLegal = mergeLegalEvidenceMaps({
                  existing: order.checkoutDetails.legal,
                  incoming: input.legalEvidence,
                });
                const checkoutDetails = checkoutDetailsJsonSchema.parse({
                  ...order.checkoutDetails,
                  legal: mergedLegal,
                });
                const [updated] = await tx
                  .update(paymentOrders)
                  .set({ checkoutDetails })
                  .where(eq(paymentOrders.id, input.id))
                  .returning();

                if (!updated) {
                  throw new PaymentOrderStateError({
                    operation: "paymentOrders.mergeLegalEvidence",
                    orderId: input.id,
                    message: "Payment order legal evidence was not updated",
                  });
                }

                return updated;
              });
            },
            { preserveError: isPaymentOrderStateError }
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ id: input.id }))
      ),

      updateCheckoutDetails: Effect.fn("paymentOrders.updateCheckoutDetails")(
        function* (input) {
          const checkoutDetails = checkoutDetailsJsonSchema.parse({
            ...input.checkoutDetails,
            fulfillment: {
              accessCodePolicy: workspacePaymentOrderAccessCodePolicy,
            },
          });
          const updated = yield* runDb(
            "paymentOrders.updateCheckoutDetails",
            () =>
              db
                .update(paymentOrders)
                .set({ checkoutDetails })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    inArray(paymentOrders.paymentStatus, [
                      "created",
                      "payment_failed",
                      "cancelled",
                      "expired",
                    ]),
                    eq(paymentOrders.fulfillmentStatus, "not_started"),
                    isNull(paymentOrders.securityToken)
                  )
                )
                .returning()
          );

          const [order] = updated;
          if (!order) {
            return yield* Effect.fail(
              new PaymentOrderStateError({
                operation: "paymentOrders.updateCheckoutDetails",
                orderId: input.id,
                message:
                  "Only unstarted, unfulfilled orders can refresh checkout details",
              })
            );
          }

          return order;
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ id: input.id }))
      ),

      deleteUnassociatedCreated: Effect.fn(
        "paymentOrders.deleteUnassociatedCreated"
      )(
        function* (id) {
          const deleted = yield* runDb(
            "paymentOrders.deleteUnassociatedCreated",
            () =>
              db
                .delete(paymentOrders)
                .where(
                  and(
                    eq(paymentOrders.id, id),
                    eq(paymentOrders.paymentStatus, "created"),
                    isNull(paymentOrders.securityToken),
                    isNull(paymentOrders.lastProviderOperationId),
                    isNull(paymentOrders.lastProviderStatus)
                  )
                )
                .returning({ id: paymentOrders.id })
          );

          yield* ensureUpdated(
            deleted,
            "paymentOrders.deleteUnassociatedCreated",
            id,
            "Only unassociated created orders can be deleted"
          );
        },
        (effect, orderId) => effect.pipe(Effect.annotateLogs({ orderId }))
      ),

      attachNexiSession: Effect.fn("paymentOrders.attachNexiSession")(
        function* (input) {
          const updated = yield* runDb("paymentOrders.attachNexiSession", () =>
            db
              .update(paymentOrders)
              .set({
                securityToken: input.securityToken,
                lastProviderOperationId: input.providerOperationId,
                lastProviderStatus: input.providerStatus,
                ...(input.providerRedirectUrl && {
                  checkoutDetails: sql`jsonb_set(${paymentOrders.checkoutDetails}, '{payment,providerRedirectUrl}', to_jsonb(${input.providerRedirectUrl}::text), true)`,
                }),
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
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      claimNexiSessionCreation: Effect.fn(
        "paymentOrders.claimNexiSessionCreation"
      )(
        function* (id) {
          const updated = yield* runDb(
            "paymentOrders.claimNexiSessionCreation",
            () =>
              db
                .update(paymentOrders)
                .set({ lastProviderStatus: "hpp_creating" })
                .where(
                  and(
                    eq(paymentOrders.id, id),
                    eq(paymentOrders.paymentStatus, "created"),
                    isNull(paymentOrders.securityToken),
                    isNull(paymentOrders.lastProviderStatus)
                  )
                )
                .returning({ id: paymentOrders.id })
          );

          return updated.length > 0;
        },
        (effect, orderId) => effect.pipe(Effect.annotateLogs({ orderId }))
      ),

      findById,

      markPaymentPending: Effect.fn("paymentOrders.markPaymentPending")(
        function* (id) {
          const updated = yield* runDb("paymentOrders.markPaymentPending", () =>
            db
              .update(paymentOrders)
              .set({ paymentStatus: "payment_pending" })
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
        },
        (effect, orderId) => effect.pipe(Effect.annotateLogs({ orderId }))
      ),

      resetUnsuccessfulForRetry: Effect.fn(
        "paymentOrders.resetUnsuccessfulForRetry"
      )(
        function* (input) {
          const checkoutDetails = checkoutDetailsJsonSchema.parse({
            ...input.checkoutDetails,
            fulfillment: {
              accessCodePolicy: workspacePaymentOrderAccessCodePolicy,
            },
          });
          const updated = yield* runDb(
            "paymentOrders.resetUnsuccessfulForRetry",
            () =>
              db
                .update(paymentOrders)
                .set({
                  correlationId: input.correlationId,
                  checkoutDetails,
                  paymentStatus: "created",
                  securityToken: null,
                  lastWebhookEventId: null,
                  lastProviderOperationId: null,
                  lastProviderStatus: null,
                  failureCode: null,
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    inArray(paymentOrders.paymentStatus, [
                      "payment_failed",
                      "cancelled",
                      "expired",
                    ]),
                    eq(paymentOrders.fulfillmentStatus, "not_started")
                  )
                )
                .returning()
          );

          const [order] = updated;
          if (!order) {
            return yield* Effect.fail(
              new PaymentOrderStateError({
                operation: "paymentOrders.resetUnsuccessfulForRetry",
                orderId: input.id,
                message:
                  "Only unsuccessful, unfulfilled terminal orders can be retried",
              })
            );
          }

          return order;
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markPaid: Effect.fn("paymentOrders.markPaid")(
        function* (input) {
          return yield* runDb<void, PaymentOrderStateError>(
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
                  })
                  .where(eq(paymentOrders.id, input.id));
              });
            },
            { preserveError: isPaymentOrderStateError }
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markFailed: Effect.fn("paymentOrders.markFailed")(
        function* (input) {
          yield* markUnsuccessfulTerminal({
            ...input,
            status: "payment_failed",
          });
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markCancelled: Effect.fn("paymentOrders.markCancelled")(
        function* (input) {
          yield* markUnsuccessfulTerminal({
            ...input,
            status: "cancelled",
          });
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markExpired: Effect.fn("paymentOrders.markExpired")(
        function* (input) {
          yield* markUnsuccessfulTerminal({
            ...input,
            status: "expired",
          });
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markUnsuccessfulTerminal,

      attachDotyposReservation: Effect.fn(
        "paymentOrders.attachDotyposReservation"
      )(
        function* (input) {
          const updated = yield* runDb(
            "paymentOrders.attachDotyposReservation",
            () =>
              db
                .update(paymentOrders)
                .set({
                  dotyposReservationId: input.dotyposReservationId,
                  dotyposReservationStatus: "CONFIRMED",
                  reservationCreatedAt: input.reservationCreatedAt,
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    eq(paymentOrders.paymentStatus, "paid"),
                    eq(paymentOrders.fulfillmentStatus, "processing"),
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
            "Reservation can only be attached to paid processing orders and cannot overwrite a different reservation"
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      claimReservationCreation: Effect.fn(
        "paymentOrders.claimReservationCreation"
      )(
        function* (id) {
          const updated = yield* runDb(
            "paymentOrders.claimReservationCreation",
            () =>
              db
                .update(paymentOrders)
                .set({
                  dotyposReservationId: null,
                  dotyposReservationStatus: "creating",
                  reservationCreatedAt: null,
                  reservationCancelledAt: null,
                  reservationCancellationFailureCode: null,
                  reservationCancellationFailureMessage: null,
                })
                .where(
                  and(
                    eq(paymentOrders.id, id),
                    eq(paymentOrders.paymentStatus, "created"),
                    or(
                      and(
                        eq(paymentOrders.dotyposReservationStatus, "none"),
                        isNull(paymentOrders.dotyposReservationId)
                      ),
                      eq(paymentOrders.dotyposReservationStatus, "CANCELLED")
                    )
                  )
                )
                .returning({ id: paymentOrders.id })
          );

          return updated.length > 0;
        },
        (effect, orderId) => effect.pipe(Effect.annotateLogs({ orderId }))
      ),

      releaseReservationCreation: Effect.fn(
        "paymentOrders.releaseReservationCreation"
      )(
        function* (id) {
          const updated = yield* runDb(
            "paymentOrders.releaseReservationCreation",
            () =>
              db
                .update(paymentOrders)
                .set({ dotyposReservationStatus: "none" })
                .where(
                  and(
                    eq(paymentOrders.id, id),
                    eq(paymentOrders.paymentStatus, "created"),
                    eq(paymentOrders.dotyposReservationStatus, "creating"),
                    isNull(paymentOrders.dotyposReservationId)
                  )
                )
                .returning({ id: paymentOrders.id })
          );

          yield* ensureUpdated(
            updated,
            "paymentOrders.releaseReservationCreation",
            id,
            "Only creating orders without a reservation can release creation"
          );
        },
        (effect, orderId) => effect.pipe(Effect.annotateLogs({ orderId }))
      ),

      attachNewReservationHold: Effect.fn(
        "paymentOrders.attachNewReservationHold"
      )(
        function* (input) {
          const updated = yield* runDb(
            "paymentOrders.attachNewReservationHold",
            () =>
              db
                .update(paymentOrders)
                .set({
                  dotyposReservationId: input.dotyposReservationId,
                  dotyposReservationStatus: "NEW",
                  reservationCreatedAt: input.reservationCreatedAt,
                  ...(input.reservationHoldExpiresAt && {
                    reservationHoldExpiresAt: input.reservationHoldExpiresAt,
                  }),
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    eq(paymentOrders.paymentStatus, "created"),
                    eq(paymentOrders.dotyposReservationStatus, "creating"),
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
            "paymentOrders.attachNewReservationHold",
            input.id,
            "Only creating created orders can attach a NEW reservation hold"
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markReservationAttachCancellationPending: Effect.fn(
        "paymentOrders.markReservationAttachCancellationPending"
      )(
        function* (input) {
          const updated = yield* runDb(
            "paymentOrders.markReservationAttachCancellationPending",
            () =>
              db
                .update(paymentOrders)
                .set({
                  dotyposReservationId: input.dotyposReservationId,
                  dotyposReservationStatus: "cancellation_pending",
                  reservationCreatedAt: input.reservationCreatedAt,
                  reservationCancellationFailureCode: input.failureCode,
                  reservationCancellationFailureMessage: input.failureMessage,
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    eq(paymentOrders.paymentStatus, "created"),
                    eq(paymentOrders.dotyposReservationStatus, "creating"),
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
            "paymentOrders.markReservationAttachCancellationPending",
            input.id,
            "Only creating created orders can attach a hold for cancellation"
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      claimReservationCancellation: Effect.fn(
        "paymentOrders.claimReservationCancellation"
      )(
        function* (id) {
          return yield* runDb(
            "paymentOrders.claimReservationCancellation",
            () =>
              db
                .update(paymentOrders)
                .set({
                  dotyposReservationStatus: "cancellation_pending",
                  reservationCancellationFailureCode: null,
                  reservationCancellationFailureMessage: null,
                })
                .where(
                  and(
                    eq(paymentOrders.id, id),
                    inArray(paymentOrders.paymentStatus, [
                      "created",
                      "payment_pending",
                    ]),
                    inArray(paymentOrders.dotyposReservationStatus, [
                      "NEW",
                      "cancellation_pending",
                    ]),
                    isNotNull(paymentOrders.dotyposReservationId)
                  )
                )
                .returning()
                .then((rows) => rows[0] ?? null)
          );
        },
        (effect, orderId) => effect.pipe(Effect.annotateLogs({ orderId }))
      ),

      markReservationCancelled: Effect.fn(
        "paymentOrders.markReservationCancelled"
      )(
        function* (input) {
          const updated = yield* runDb(
            "paymentOrders.markReservationCancelled",
            () =>
              db
                .update(paymentOrders)
                .set({
                  dotyposReservationStatus: "CANCELLED",
                  reservationCancelledAt: input.cancelledAt,
                  reservationHoldExpiredAt: input.holdExpiredAt,
                  reservationCancellationFailureCode: null,
                  reservationCancellationFailureMessage: null,
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    inArray(paymentOrders.paymentStatus, [
                      "created",
                      "payment_pending",
                    ]),
                    eq(
                      paymentOrders.dotyposReservationStatus,
                      "cancellation_pending"
                    )
                  )
                )
                .returning({ id: paymentOrders.id })
          );

          yield* ensureUpdated(
            updated,
            "paymentOrders.markReservationCancelled",
            input.id,
            "Only cancellation-pending unpaid reservations can be marked cancelled"
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markReservationCancellationFailed: Effect.fn(
        "paymentOrders.markReservationCancellationFailed"
      )(
        function* (input) {
          const updated = yield* runDb(
            "paymentOrders.markReservationCancellationFailed",
            () =>
              db
                .update(paymentOrders)
                .set({
                  reservationCancellationFailureCode: input.failureCode,
                  reservationCancellationFailureMessage: input.failureMessage,
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    eq(
                      paymentOrders.dotyposReservationStatus,
                      "cancellation_pending"
                    )
                  )
                )
                .returning({ id: paymentOrders.id })
          );

          yield* ensureUpdated(
            updated,
            "paymentOrders.markReservationCancellationFailed",
            input.id,
            "Only cancellation-pending reservations can record cancellation failure"
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markReservationConfirmed: Effect.fn(
        "paymentOrders.markReservationConfirmed"
      )(
        function* (input) {
          const updated = yield* runDb(
            "paymentOrders.markReservationConfirmed",
            () =>
              db
                .update(paymentOrders)
                .set({
                  dotyposReservationStatus: "CONFIRMED",
                  reservationConfirmedAt: input.confirmedAt,
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    eq(paymentOrders.paymentStatus, "paid"),
                    inArray(paymentOrders.dotyposReservationStatus, [
                      "NEW",
                      "CONFIRMED",
                    ]),
                    isNotNull(paymentOrders.dotyposReservationId)
                  )
                )
                .returning({ id: paymentOrders.id })
          );

          yield* ensureUpdated(
            updated,
            "paymentOrders.markReservationConfirmed",
            input.id,
            "Only paid orders with an active reservation can be confirmed"
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      selectExpiredReservationHolds: Effect.fn(
        "paymentOrders.selectExpiredReservationHolds"
      )(
        function* (input) {
          return yield* runDb("paymentOrders.selectExpiredReservationHolds", () =>
            db
              .select()
              .from(paymentOrders)
              .where(
                and(
                  inArray(paymentOrders.dotyposReservationStatus, [
                    "NEW",
                    "cancellation_pending",
                  ]),
                  inArray(paymentOrders.paymentStatus, [
                    "created",
                    "payment_pending",
                  ]),
                  or(
                    and(
                      isNotNull(paymentOrders.reservationHoldExpiresAt),
                      lte(paymentOrders.reservationHoldExpiresAt, input.now)
                    ),
                    eq(
                      paymentOrders.dotyposReservationStatus,
                      "cancellation_pending"
                    )
                  )
                )
              )
              .orderBy(asc(paymentOrders.reservationHoldExpiresAt))
              .limit(input.limit)
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      claimPaidFulfillment: Effect.fn("paymentOrders.claimPaidFulfillment")(
        function* (id) {
          return yield* runDb(
            "paymentOrders.claimPaidFulfillment",
            async () => {
              const [order] = await db
                .update(paymentOrders)
                .set({
                  fulfillmentStatus: "processing",
                })
                .where(
                  and(
                    eq(paymentOrders.id, id),
                    eq(paymentOrders.paymentStatus, "paid"),
                    inArray(paymentOrders.fulfillmentStatus, [
                      "not_started",
                      "failed",
                    ])
                  )
                )
                .returning();

              return order ?? null;
            }
          );
        },
        (effect, orderId) => effect.pipe(Effect.annotateLogs({ orderId }))
      ),

      markCustomerAccessEmailSent: Effect.fn(
        "paymentOrders.markCustomerAccessEmailSent"
      )(
        function* (input) {
          return yield* runDb(
            "paymentOrders.markCustomerAccessEmailSent",
            async () => {
              const updated = await db
                .update(paymentOrders)
                .set({
                  customerAccessEmailSentAt: input.sentAt,
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    eq(paymentOrders.paymentStatus, "paid"),
                    eq(paymentOrders.fulfillmentStatus, "processing"),
                    isNull(paymentOrders.customerAccessEmailSentAt)
                  )
                )
                .returning({ id: paymentOrders.id });
              return updated.length > 0;
            }
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markInternalNotificationSent: Effect.fn(
        "paymentOrders.markInternalNotificationSent"
      )(
        function* (input) {
          return yield* runDb(
            "paymentOrders.markInternalNotificationSent",
            async () => {
              const updated = await db
                .update(paymentOrders)
                .set({
                  internalNotificationSentAt: input.sentAt,
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    eq(paymentOrders.paymentStatus, "paid"),
                    eq(paymentOrders.fulfillmentStatus, "processing"),
                    isNull(paymentOrders.internalNotificationSentAt)
                  )
                )
                .returning({ id: paymentOrders.id });
              return updated.length > 0;
            }
          );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markFulfilled: Effect.fn("paymentOrders.markFulfilled")(
        function* (input) {
          const updated = yield* runDb("paymentOrders.markFulfilled", () =>
            db
              .update(paymentOrders)
              .set({
                fulfillmentStatus: "fulfilled",
                fulfilledAt: input.fulfilledAt,
              })
              .where(
                and(
                  eq(paymentOrders.id, input.id),
                  eq(paymentOrders.paymentStatus, "paid"),
                  eq(paymentOrders.fulfillmentStatus, "processing"),
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
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markFulfillmentFailed: Effect.fn("paymentOrders.markFulfillmentFailed")(
        function* (input) {
          const updated = yield* runDb(
            "paymentOrders.markFulfillmentFailed",
            () =>
              db
                .update(paymentOrders)
                .set({
                  fulfillmentStatus: "failed",
                  fulfillmentFailedAt: input.failedAt,
                  fulfillmentFailureCode: input.failureCode,
                })
                .where(
                  and(
                    eq(paymentOrders.id, input.id),
                    eq(paymentOrders.paymentStatus, "paid"),
                    eq(paymentOrders.fulfillmentStatus, "processing")
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
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),
    });
  })
);
