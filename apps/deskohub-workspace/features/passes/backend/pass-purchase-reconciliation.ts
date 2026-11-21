import "server-only";

import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  entryPackGiftInvitations,
  orders,
  passPurchases,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import { OrderPaymentHandlers } from "@/features/checkout/backend/payment/order-payment-handlers.service";
import { PaymentProviders } from "@/features/checkout/backend/payment/payment-provider";
import { PaymentProvidersLive } from "@/features/checkout/backend/payment/payment-providers";
import { ProviderPaymentFinalizationService } from "@/features/checkout/backend/payment/provider-payment-finalization.service";
import { providerOrderAbandonmentTimeoutMinutes } from "@/features/checkout/provider-order-abandonment";
import { endedUnpaidPaymentStates } from "@/features/order";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { entryPackGiftInvitationDue } from "./entry-pack-gift";
import { settlePassPurchase } from "./entry-pack-settlement";
import { PassDayMoves } from "./unlimited-pass-day-moves";
import { releaseUnlimitedPassDays } from "./unlimited-pass-holds";

/** Retries paid fulfillment and resolves abandoned attempts from provider facts. */
export const reconcilePassPurchases = Effect.fn("reconcilePassPurchases")(
  function* (input: {
    readonly now: Temporal.Instant;
    readonly limit: number;
  }) {
    const { db, transaction } = yield* WorkspaceDatabase;
    const finalization = yield* ProviderPaymentFinalizationService;
    const providers = yield* PaymentProviders;
    const registry = yield* OrderPaymentHandlers;
    const handler = registry.byKind["pass-purchase"];
    if (!handler)
      return {
        paymentsChecked: 0,
        fulfillmentRetried: 0,
        recoveriesRetried: 0,
      };

    const retryBefore = input.now.subtract({ minutes: 5 });
    const providerCreatedBefore = input.now.subtract({
      minutes: providerOrderAbandonmentTimeoutMinutes,
    });
    // Move each claimed row to the back before calling providers. This also
    // gives an interrupted or inconclusive run a finite retry delay.
    const { expired, unfulfilled, recoveries } = yield* transaction(
      Effect.gen(function* () {
        const expired = yield* db
          .select({
            orderId: orders.id,
            paymentAttemptId: paymentAttempts.id,
          })
          .from(orders)
          .innerJoin(
            paymentAttempts,
            and(
              eq(paymentAttempts.id, orders.activePaymentAttemptId),
              eq(paymentAttempts.orderId, orders.id)
            )
          )
          .where(
            and(
              eq(orders.kind, "pass-purchase"),
              eq(orders.paymentState, "pending"),
              inArray(paymentAttempts.provider, providers.activeProviders),
              inArray(paymentAttempts.state, ["created", "pending"]),
              lte(orders.updatedAt, retryBefore),
              or(
                lte(
                  paymentAttempts.providerOrderCreatedAt,
                  providerCreatedBefore
                ),
                and(
                  isNull(paymentAttempts.providerOrderCreatedAt),
                  lte(paymentAttempts.createdAt, providerCreatedBefore)
                )
              )
            )
          )
          .orderBy(asc(orders.updatedAt), asc(orders.id))
          .limit(input.limit)
          .for("no key update", { of: orders, skipLocked: true });
        const unfulfilled = yield* db
          .select({ orderId: orders.id })
          .from(orders)
          .leftJoin(
            entryPackGiftInvitations,
            eq(entryPackGiftInvitations.orderId, orders.id)
          )
          .where(
            and(
              eq(orders.kind, "pass-purchase"),
              eq(orders.paymentState, "paid"),
              or(
                inArray(orders.fulfillmentState, [
                  "not_started",
                  "awaiting_delivery",
                ]),
                entryPackGiftInvitationDue(input.now)
              ),
              lte(orders.updatedAt, retryBefore)
            )
          )
          .orderBy(asc(orders.updatedAt), asc(orders.id))
          .limit(input.limit)
          .for("no key update", { of: orders, skipLocked: true });
        const winningAttempt = eq(
          orders.activePaymentAttemptId,
          paymentAttempts.id
        );
        const supersededAttempt = sql`${orders.activePaymentAttemptId} is distinct from ${paymentAttempts.id}`;
        const unpaidOrder = inArray(
          orders.paymentState,
          endedUnpaidPaymentStates
        );
        const refundedPartially = and(
          eq(paymentAttempts.refundState, "refunded"),
          lt(paymentAttempts.refundedAmountValue, paymentAttempts.amountValue)
        );
        const recoveries = yield* db
          .select({ orderId: orders.id, paymentAttemptId: paymentAttempts.id })
          .from(paymentAttempts)
          .innerJoin(orders, eq(orders.id, paymentAttempts.orderId))
          .innerJoin(passPurchases, eq(passPurchases.id, orders.id))
          .where(
            and(
              eq(passPurchases.product, "unlimited"),
              eq(paymentAttempts.state, "paid"),
              ne(paymentAttempts.provider, "internal"),
              lte(orders.updatedAt, retryBefore),
              or(
                and(
                  supersededAttempt,
                  or(
                    eq(paymentAttempts.refundState, "not_required"),
                    refundedPartially,
                    and(
                      eq(paymentAttempts.refundState, "required"),
                      lt(
                        paymentAttempts.refundTargetValue,
                        paymentAttempts.amountValue
                      )
                    )
                  )
                ),
                and(
                  winningAttempt,
                  unpaidOrder,
                  or(
                    eq(paymentAttempts.refundState, "not_required"),
                    and(
                      refundedPartially,
                      isNull(paymentAttempts.refundTargetValue)
                    ),
                    and(
                      isNull(orders.paidAt),
                      eq(paymentAttempts.refundState, "required"),
                      isNull(paymentAttempts.refundTargetValue)
                    ),
                    eq(passPurchases.status, "pending_payment")
                  )
                )
              )
            )
          )
          .orderBy(
            asc(orders.updatedAt),
            asc(orders.id),
            asc(paymentAttempts.id)
          )
          .limit(Math.min(input.limit, 2))
          .for("no key update", { of: orders, skipLocked: true });
        const claimed = [...expired, ...unfulfilled, ...recoveries].map(
          ({ orderId }) => orderId
        );
        if (claimed.length > 0) {
          yield* db
            .update(orders)
            .set({ updatedAt: input.now })
            .where(inArray(orders.id, claimed));
        }
        return { expired, unfulfilled, recoveries };
      })
    );
    for (const { orderId, paymentAttemptId } of expired) {
      yield* Effect.gen(function* () {
        const result = yield* finalization.finalizePendingProviderPayment({
          orderId,
          paymentAttemptId,
          abandonmentCheckedAt: input.now,
          verificationDeadline: "8 seconds",
        });
        if (result === "abandoned") {
          yield* handler.markTerminal({
            orderId,
            id: paymentAttemptId,
            state: "expired",
            failureCode: "payment_abandoned_after_provider_cutoff",
            fromAttemptStates: ["pending"],
          });
        }
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Pass payment reconciliation failed", {
            orderId,
            cause,
          })
        )
      );
    }
    for (const recovery of recoveries) {
      yield* handler.resumeRecovery(recovery).pipe(
        Effect.timeout("90 seconds"),
        Effect.catch(() =>
          Effect.logWarning(
            "Unlimited pass payment recovery needs reconciliation",
            { orderId: recovery.orderId }
          )
        )
      );
    }
    for (const { orderId } of unfulfilled) {
      yield* handler.fulfill(orderId).pipe(
        Effect.catch(() =>
          Effect.logWarning("Pass fulfillment retry failed", {
            orderId,
          })
        )
      );
    }
    return {
      paymentsChecked: expired.length,
      fulfillmentRetried: unfulfilled.length,
      recoveriesRetried: recoveries.length,
    };
  }
);

export const runPassPurchaseReconciliation = Effect.fn(
  "runPassPurchaseReconciliation"
)(
  function* (input: {
    readonly now: Temporal.Instant;
    readonly limit: number;
  }) {
    const summary = yield* reconcilePassPurchases(input);
    const releasesChecked = yield* reconcileUnlimitedPassReleases(input);
    const moves = yield* PassDayMoves;
    const reseatsChecked = yield* moves.reconcile(input.limit);
    return { ...summary, releasesChecked, reseatsChecked };
  },
  Effect.provide(
    Layer.mergeAll(
      PassDayMoves.Default.pipe(
        Layer.provide(WorkspaceReservationRepository.Live),
        Layer.provide(WorkspaceDatabase.Default),
        Layer.provide(WorkspaceDatabaseAdvisoryLock.Default),
        Layer.provide(WorkspaceDotyposLayer)
      ),
      WorkspaceDatabase.Default,
      WorkspaceDatabaseAdvisoryLock.Default,
      WorkspaceDotyposLayer,
      OrderPaymentHandlers.Live,
      PaymentProvidersLive,
      ProviderPaymentFinalizationService.Live
    )
  )
);

export const reconcileUnlimitedPassReleases = Effect.fn(
  "reconcileUnlimitedPassReleases"
)(function* (input: {
  readonly now: Temporal.Instant;
  readonly limit: number;
}) {
  const { db, transaction } = yield* WorkspaceDatabase;
  const expiryDue = and(
    eq(passPurchases.status, "pending_payment"),
    or(
      and(
        eq(orders.paymentState, "not_started"),
        lte(passPurchases.holdsExpireAt, input.now)
      ),
      and(
        inArray(orders.paymentState, endedUnpaidPaymentStates),
        notExists(
          db
            .select({ id: paymentAttempts.id })
            .from(paymentAttempts)
            .where(
              and(
                eq(paymentAttempts.id, orders.activePaymentAttemptId),
                eq(paymentAttempts.state, "paid")
              )
            )
        )
      )
    )
  );
  const releaseDue = and(
    or(
      eq(passPurchases.status, "void"),
      and(
        inArray(passPurchases.status, ["withdrawn", "cancelled"]),
        isNotNull(passPurchases.accessEndsOn)
      )
    ),
    exists(
      db
        .select({ id: workspaceReservations.id })
        .from(workspaceReservations)
        .where(
          and(
            eq(workspaceReservations.passId, passPurchases.id),
            notInArray(workspaceReservations.reservationState, [
              "cancelled",
              "hold_expired",
            ]),
            sql`(${passPurchases.accessEndsOn} is null or ${workspaceReservations.serviceDate} >= ${passPurchases.accessEndsOn})`
          )
        )
    )
  );
  const due = or(expiryDue, releaseDue);
  const batch = yield* db
    .select({ id: passPurchases.id })
    .from(passPurchases)
    .innerJoin(orders, eq(orders.id, passPurchases.id))
    .where(and(eq(passPurchases.product, "unlimited"), due))
    .orderBy(asc(orders.updatedAt), asc(orders.id))
    .limit(Math.min(input.limit, 2));

  for (const { id } of batch) {
    yield* Effect.gen(function* () {
      const purchase = yield* transaction(
        Effect.gen(function* () {
          const [entry] = yield* db
            .select({ order: orders, purchase: passPurchases })
            .from(passPurchases)
            .innerJoin(orders, eq(orders.id, passPurchases.id))
            .where(and(eq(passPurchases.id, id), due))
            .for("no key update", { of: orders });
          if (!entry) return undefined;
          yield* db
            .update(orders)
            .set({
              updatedAt: input.now,
              paymentState:
                entry.purchase.status === "pending_payment" &&
                entry.order.paymentState === "not_started"
                  ? "expired"
                  : entry.order.paymentState,
            })
            .where(eq(orders.id, id));
          if (entry.purchase.status !== "pending_payment")
            return entry.purchase;
          yield* settlePassPurchase(id);
          const [expired] = yield* db
            .select()
            .from(passPurchases)
            .where(eq(passPurchases.id, id));
          return expired;
        })
      );
      if (purchase) yield* releaseUnlimitedPassDays(purchase);
    }).pipe(
      WorkspaceLockSections.passPurchaseFulfillment(id),
      WorkspaceLockSections.unlimitedPassRecovery(id),
      Effect.timeout("90 seconds"),
      Effect.catch(() =>
        Effect.logWarning("Unlimited pass release needs reconciliation", {
          orderId: id,
        })
      )
    );
  }
  return batch.length;
});
