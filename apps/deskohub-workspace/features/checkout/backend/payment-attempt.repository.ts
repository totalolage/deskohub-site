import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer, Predicate } from "effect";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import {
  type PaymentAttempt,
  type PaymentState,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";

export class PaymentAttemptStateError extends Data.TaggedError(
  "PaymentAttemptStateError"
)<{
  readonly operation: string;
  readonly paymentAttemptId: string;
  readonly message: string;
}> {}

export interface PaymentAttemptReservationTransition {
  readonly attempt: PaymentAttempt;
  readonly changed: boolean;
  readonly timestamp: Date;
}

export interface PaymentAttemptRepository {
  readonly create: (input: {
    readonly workspaceReservationId: string;
    readonly providerOrderId: string;
    readonly amountValue: number;
    readonly amountExponent: number;
    readonly currency: string;
  }) => Effect.Effect<PaymentAttempt, DatabaseError | PaymentAttemptStateError>;
  readonly findById: (
    id: string
  ) => Effect.Effect<PaymentAttempt | null, DatabaseError>;
  readonly findByProviderOrderId: (
    providerOrderId: string
  ) => Effect.Effect<PaymentAttempt | null, DatabaseError>;
  readonly findDisplayableForReservation: (input: {
    readonly workspaceReservationId: string;
    readonly activePaymentAttemptId?: string;
    readonly paymentState: PaymentState;
  }) => Effect.Effect<PaymentAttempt | null, DatabaseError>;
  readonly attachHostedPaymentPage: (input: {
    readonly id: string;
    readonly securityToken: string;
    readonly providerRedirectUrl: string;
  }) => Effect.Effect<PaymentAttempt, DatabaseError | PaymentAttemptStateError>;
  readonly markPaid: (input: {
    readonly id: string;
    readonly webhookEventId?: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
  }) => Effect.Effect<void, DatabaseError | PaymentAttemptStateError>;
  readonly markTerminal: (input: {
    readonly id: string;
    readonly state: "failed" | "cancelled" | "expired";
    readonly failureCode: string;
    readonly webhookEventId?: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
  }) => Effect.Effect<void, DatabaseError | PaymentAttemptStateError>;
  readonly markPaidForReservation: (input: {
    readonly id: string;
    readonly workspaceReservationId: string;
    readonly webhookEventId?: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
    readonly paidAt: Date;
  }) => Effect.Effect<
    PaymentAttemptReservationTransition,
    DatabaseError | PaymentAttemptStateError
  >;
  readonly markTerminalForReservation: (input: {
    readonly id: string;
    readonly workspaceReservationId: string;
    readonly state: "failed" | "cancelled" | "expired";
    readonly failureCode: string;
    readonly webhookEventId?: string;
    readonly providerOperationId?: string;
    readonly providerStatus?: string;
  }) => Effect.Effect<
    PaymentAttemptReservationTransition,
    DatabaseError | PaymentAttemptStateError
  >;
}

export const PaymentAttemptRepository =
  Context.Service<PaymentAttemptRepository>("PaymentAttemptRepository");

const isPaymentAttemptStateError = (
  cause: unknown
): cause is PaymentAttemptStateError =>
  Predicate.isTagged(cause, "PaymentAttemptStateError");

export const PaymentAttemptRepositoryLive = Layer.effect(
  PaymentAttemptRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    return PaymentAttemptRepository.of({
      create: Effect.fn("paymentAttempts.create")(function* (input) {
        const result = yield* runDb<PaymentAttempt, PaymentAttemptStateError>(
          "paymentAttempts.create",
          async () => {
            return await db.transaction(async (tx): Promise<PaymentAttempt> => {
              const [attempt] = await tx
                .insert(paymentAttempts)
                .values({
                  id: postgresUuidV7,
                  workspaceReservationId: input.workspaceReservationId,
                  provider: "nexi",
                  providerOrderId: input.providerOrderId,
                  state: "created",
                  amountValue: input.amountValue,
                  amountExponent: input.amountExponent,
                  currency: input.currency,
                })
                .returning();

              if (!attempt)
                throw new Error("Payment attempt insert returned no row");

              const [linked] = await tx
                .update(workspaceReservations)
                .set({
                  activePaymentAttemptId: attempt.id,
                  paymentState: "pending",
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(workspaceReservations.id, input.workspaceReservationId),
                    eq(workspaceReservations.reservationState, "held"),
                    inArray(workspaceReservations.paymentState, [
                      "not_started",
                      "failed",
                      "cancelled",
                      "expired",
                    ])
                  )
                )
                .returning({ id: workspaceReservations.id });

              if (!linked) {
                throw new PaymentAttemptStateError({
                  operation: "paymentAttempts.create",
                  paymentAttemptId: attempt.id,
                  message:
                    "Payment attempts can only be created for held unpaid reservations.",
                });
              }

              return attempt;
            });
          },
          { preserveError: isPaymentAttemptStateError }
        );

        return result;
      }),
      findById: Effect.fn("paymentAttempts.findById")(function* (id) {
        return yield* runDb("paymentAttempts.findById", async () => {
          const [attempt] = await db
            .select()
            .from(paymentAttempts)
            .where(eq(paymentAttempts.id, id))
            .limit(1);
          return attempt ?? null;
        });
      }),
      findByProviderOrderId: Effect.fn("paymentAttempts.findByProviderOrderId")(
        function* (providerOrderId) {
          return yield* runDb(
            "paymentAttempts.findByProviderOrderId",
            async () => {
              const [attempt] = await db
                .select()
                .from(paymentAttempts)
                .where(eq(paymentAttempts.providerOrderId, providerOrderId))
                .limit(1);
              return attempt ?? null;
            }
          );
        }
      ),
      findDisplayableForReservation: Effect.fn(
        "paymentAttempts.findDisplayableForReservation"
      )(function* (input) {
        return yield* runDb(
          "paymentAttempts.findDisplayableForReservation",
          async () => {
            const [attempt] = await db
              .select()
              .from(paymentAttempts)
              .where(
                and(
                  eq(
                    paymentAttempts.workspaceReservationId,
                    input.workspaceReservationId
                  ),
                  or(
                    and(
                      eq(
                        paymentAttempts.id,
                        input.activePaymentAttemptId ?? ""
                      ),
                      inArray(paymentAttempts.state, [
                        "created",
                        "pending",
                        "paid",
                      ])
                    ),
                    input.paymentState === "paid"
                      ? eq(paymentAttempts.state, "paid")
                      : sql`false`
                  )
                )
              )
              .orderBy(
                sql`case
                  when ${paymentAttempts.id} = ${input.activePaymentAttemptId ?? ""} then 0
                  when ${paymentAttempts.state} = 'paid' then 1
                  else 2
                end`,
                desc(paymentAttempts.updatedAt)
              )
              .limit(1);
            return attempt ?? null;
          }
        );
      }),
      attachHostedPaymentPage: Effect.fn(
        "paymentAttempts.attachHostedPaymentPage"
      )(function* (input) {
        const attachedAt = new Date();
        const updated = yield* runDb(
          "paymentAttempts.attachHostedPaymentPage",
          () =>
            db
              .update(paymentAttempts)
              .set({
                state: "pending",
                securityToken: input.securityToken,
                providerRedirectUrl: input.providerRedirectUrl,
                updatedAt: attachedAt,
              })
              .where(
                and(
                  eq(paymentAttempts.id, input.id),
                  eq(paymentAttempts.state, "created")
                )
              )
              .returning()
        );

        const attempt = updated[0];
        if (!attempt) {
          return yield* Effect.fail(
            new PaymentAttemptStateError({
              operation: "paymentAttempts.attachHostedPaymentPage",
              paymentAttemptId: input.id,
              message:
                "Only created payment attempts can attach a hosted payment page.",
            })
          );
        }

        return attempt;
      }),
      markPaid: Effect.fn("paymentAttempts.markPaid")(function* (input) {
        const updated = yield* runDb("paymentAttempts.markPaid", () =>
          db
            .update(paymentAttempts)
            .set({
              state: "paid",
              lastWebhookEventId: input.webhookEventId,
              lastProviderOperationId: input.providerOperationId,
              lastProviderStatus: input.providerStatus,
              failureCode: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(paymentAttempts.id, input.id),
                eq(paymentAttempts.state, "pending")
              )
            )
            .returning({ id: paymentAttempts.id })
        );

        if (updated.length === 0) {
          return yield* Effect.fail(
            new PaymentAttemptStateError({
              operation: "paymentAttempts.markPaid",
              paymentAttemptId: input.id,
              message: "Only pending payment attempts can be marked paid.",
            })
          );
        }
      }),
      markTerminal: Effect.fn("paymentAttempts.markTerminal")(
        function* (input) {
          const updated = yield* runDb("paymentAttempts.markTerminal", () =>
            db
              .update(paymentAttempts)
              .set({
                state: input.state,
                failureCode: input.failureCode,
                lastWebhookEventId: input.webhookEventId,
                lastProviderOperationId: input.providerOperationId,
                lastProviderStatus: input.providerStatus,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(paymentAttempts.id, input.id),
                  inArray(paymentAttempts.state, ["created", "pending"])
                )
              )
              .returning({ id: paymentAttempts.id })
          );

          if (updated.length === 0) {
            return yield* Effect.fail(
              new PaymentAttemptStateError({
                operation: "paymentAttempts.markTerminal",
                paymentAttemptId: input.id,
                message:
                  "Only non-terminal payment attempts can be marked terminal.",
              })
            );
          }
        }
      ),
      markPaidForReservation: Effect.fn(
        "paymentAttempts.markPaidForReservation"
      )(function* (input) {
        const result = yield* runDb<
          PaymentAttemptReservationTransition,
          PaymentAttemptStateError
        >(
          "paymentAttempts.markPaidForReservation",
          async () => {
            return await db.transaction(
              async (tx): Promise<PaymentAttemptReservationTransition> => {
                const [attempt] = await tx
                  .update(paymentAttempts)
                  .set({
                    state: "paid",
                    lastWebhookEventId: input.webhookEventId,
                    lastProviderOperationId: input.providerOperationId,
                    lastProviderStatus: input.providerStatus,
                    failureCode: null,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(paymentAttempts.id, input.id),
                      eq(
                        paymentAttempts.workspaceReservationId,
                        input.workspaceReservationId
                      ),
                      inArray(paymentAttempts.state, ["pending", "paid"])
                    )
                  )
                  .returning();

                if (!attempt) {
                  throw new PaymentAttemptStateError({
                    operation: "paymentAttempts.markPaidForReservation",
                    paymentAttemptId: input.id,
                    message:
                      "Only pending or already-paid payment attempts can mark a reservation paid.",
                  });
                }

                const [reservation] = await tx
                  .update(workspaceReservations)
                  .set({
                    paymentState: "paid",
                    paidAt: input.paidAt,
                    failureCode: null,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(
                        workspaceReservations.id,
                        input.workspaceReservationId
                      ),
                      eq(workspaceReservations.reservationState, "held"),
                      eq(workspaceReservations.paymentState, "pending"),
                      eq(workspaceReservations.activePaymentAttemptId, input.id)
                    )
                  )
                  .returning({
                    paidAt: workspaceReservations.paidAt,
                  });

                if (reservation)
                  return {
                    attempt,
                    changed: true,
                    timestamp: reservation.paidAt ?? input.paidAt,
                  };

                const [consistent] = await tx
                  .select({
                    paidAt: workspaceReservations.paidAt,
                  })
                  .from(workspaceReservations)
                  .where(
                    and(
                      eq(
                        workspaceReservations.id,
                        input.workspaceReservationId
                      ),
                      eq(workspaceReservations.paymentState, "paid"),
                      eq(workspaceReservations.activePaymentAttemptId, input.id)
                    )
                  )
                  .limit(1);

                if (consistent)
                  return {
                    attempt,
                    changed: false,
                    timestamp: consistent.paidAt ?? input.paidAt,
                  };

                // Intentionally reject the transaction to roll back the payment-attempt update above.
                throw new PaymentAttemptStateError({
                  operation: "paymentAttempts.markPaidForReservation",
                  paymentAttemptId: input.id,
                  message:
                    "Only the active pending attempt on a held reservation can mark payment paid.",
                });
              }
            );
          },
          { preserveError: isPaymentAttemptStateError }
        );

        return result;
      }),
      markTerminalForReservation: Effect.fn(
        "paymentAttempts.markTerminalForReservation"
      )(function* (input) {
        const terminalAt = new Date();
        const result = yield* runDb<
          PaymentAttemptReservationTransition,
          PaymentAttemptStateError
        >(
          "paymentAttempts.markTerminalForReservation",
          async () => {
            return await db.transaction(
              async (tx): Promise<PaymentAttemptReservationTransition> => {
                const [attempt] = await tx
                  .update(paymentAttempts)
                  .set({
                    state: input.state,
                    failureCode: input.failureCode,
                    lastWebhookEventId: input.webhookEventId,
                    lastProviderOperationId: input.providerOperationId,
                    lastProviderStatus: input.providerStatus,
                    updatedAt: terminalAt,
                  })
                  .where(
                    and(
                      eq(paymentAttempts.id, input.id),
                      eq(
                        paymentAttempts.workspaceReservationId,
                        input.workspaceReservationId
                      ),
                      inArray(paymentAttempts.state, [
                        "created",
                        "pending",
                        input.state,
                      ])
                    )
                  )
                  .returning();

                if (!attempt) {
                  throw new PaymentAttemptStateError({
                    operation: "paymentAttempts.markTerminalForReservation",
                    paymentAttemptId: input.id,
                    message:
                      "Only non-terminal or matching terminal payment attempts can mark a reservation terminal.",
                  });
                }

                const [reservation] = await tx
                  .update(workspaceReservations)
                  .set({
                    paymentState: input.state,
                    failureCode: input.failureCode,
                    updatedAt: terminalAt,
                  })
                  .where(
                    and(
                      eq(
                        workspaceReservations.id,
                        input.workspaceReservationId
                      ),
                      eq(workspaceReservations.reservationState, "held"),
                      eq(workspaceReservations.paymentState, "pending"),
                      eq(workspaceReservations.activePaymentAttemptId, input.id)
                    )
                  )
                  .returning({
                    updatedAt: workspaceReservations.updatedAt,
                  });

                if (reservation)
                  return {
                    attempt,
                    changed: true,
                    timestamp: reservation.updatedAt,
                  };

                const [consistent] = await tx
                  .select({
                    updatedAt: workspaceReservations.updatedAt,
                  })
                  .from(workspaceReservations)
                  .where(
                    and(
                      eq(
                        workspaceReservations.id,
                        input.workspaceReservationId
                      ),
                      eq(workspaceReservations.paymentState, input.state),
                      eq(workspaceReservations.activePaymentAttemptId, input.id)
                    )
                  )
                  .limit(1);

                if (consistent)
                  return {
                    attempt,
                    changed: false,
                    timestamp: consistent.updatedAt,
                  };

                // Intentionally reject the transaction to roll back the payment-attempt update above.
                throw new PaymentAttemptStateError({
                  operation: "paymentAttempts.markTerminalForReservation",
                  paymentAttemptId: input.id,
                  message:
                    "Only the active pending attempt on a held reservation can mark payment terminal.",
                });
              }
            );
          },
          { preserveError: isPaymentAttemptStateError }
        );

        return result;
      }),
    });
  })
);
