import "server-only";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { orders, passPurchases } from "@/db/schema";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { isEndedUnpaidPaymentState, type OrderId } from "@/features/order";
import { currentInstant, plainDateStringSchema } from "@/shared/utils/temporal";
import { unlimitedPassDays } from "../pass-offer";
import { hasUnlimitedPassFirstDayEnded } from "./entry-pack-settlement";
import { withUnlimitedPassCapacity } from "./unlimited-pass-capacity";
import {
  createUnlimitedPassHolds,
  readUnlimitedPassDays,
  reconfirmUnlimitedPassHolds,
  releaseUnlimitedPassDays,
  UnlimitedPassHoldsUnavailable,
} from "./unlimited-pass-holds";
import {
  readUnlimitedPassDesk,
  readUnlimitedPassSelection,
  recordReplacementUnlimitedPassHolds,
} from "./unlimited-pass-orders";

/** No provider writes run in the transaction that settles the verified payment. */
export const prepareUnlimitedPassRecovery = Effect.fn(
  "prepareUnlimitedPassRecovery"
)(function* (orderId: OrderId, attemptId: PaymentAttemptId) {
  const { db, transaction } = yield* WorkspaceDatabase;
  const load = Effect.gen(function* () {
    const [entry] = yield* db
      .select({ order: orders, purchase: passPurchases })
      .from(orders)
      .innerJoin(passPurchases, eq(orders.id, passPurchases.id))
      .where(
        and(eq(orders.id, orderId), eq(passPurchases.product, "unlimited"))
      );
    if (
      entry?.order.activePaymentAttemptId === attemptId &&
      isEndedUnpaidPaymentState(entry.order.paymentState)
    ) {
      return entry.purchase;
    }
  });

  const previous = yield* Effect.gen(function* () {
    const now = yield* currentInstant;
    const purchase = yield* load;
    if (
      !purchase ||
      (purchase.status !== "void" && purchase.status !== "pending_payment")
    )
      return undefined;
    if (hasUnlimitedPassFirstDayEnded(purchase, now)) return undefined;
    let releasing = purchase;
    if (
      purchase.status === "pending_payment" &&
      (!purchase.holdsExpireAt ||
        Temporal.Instant.compare(purchase.holdsExpireAt, now) <= 0)
    ) {
      const [expired] = yield* transaction(
        Effect.gen(function* () {
          const [order] = yield* db
            .select()
            .from(orders)
            .where(eq(orders.id, orderId))
            .for("no key update");
          if (
            order?.activePaymentAttemptId !== attemptId ||
            !isEndedUnpaidPaymentState(order.paymentState)
          )
            return [];
          return yield* db
            .update(passPurchases)
            .set({ status: "void" })
            .where(
              and(
                eq(passPurchases.id, orderId),
                eq(passPurchases.status, "pending_payment")
              )
            )
            .returning();
        })
      );
      if (!expired) return undefined;
      releasing = expired;
    }
    if (releasing.status === "void") {
      yield* releaseUnlimitedPassDays(releasing);
      const days = yield* readUnlimitedPassDays(orderId);
      if (days.length !== unlimitedPassDays) return undefined;
      if (
        days.some(
          (day) =>
            day.reservationState !== "cancelled" &&
            day.reservationState !== "hold_expired"
        )
      ) {
        return yield* new UnlimitedPassHoldsUnavailable({
          reason: "unfinished",
        });
      }
    }
    return releasing;
  }).pipe(WorkspaceLockSections.passPurchaseFulfillment(orderId));
  if (!previous) return false;

  if (previous.status === "void") {
    const selection = readUnlimitedPassSelection(previous);
    if (!selection) return false;
    const now = yield* currentInstant;
    const preferredDeskId =
      previous.renewsPassId && selection.tier !== "open-space"
        ? yield* readUnlimitedPassDesk(previous.renewsPassId)
        : undefined;
    const replaced = yield* withUnlimitedPassCapacity(
      {
        selection,
        startDate: Temporal.PlainDate.from(previous.validFrom),
        ...(preferredDeskId && { preferredDeskId }),
      },
      ({ days }) =>
        transaction(
          recordReplacementUnlimitedPassHolds({
            purchase: previous,
            paidAttemptId: attemptId,
            days: days.map((day) => ({
              ...day,
              serviceDate: plainDateStringSchema.make(
                day.serviceDate.toString()
              ),
            })),
            now,
          })
        )
    ).pipe(
      Effect.as(true),
      Effect.catchTags({
        UnlimitedPassCapacityUnavailable: () => Effect.succeed(false),
        UnlimitedPassAdmissionError: () => Effect.succeed(false),
      })
    );
    if (!replaced) return false;
  }

  return yield* Effect.gen(function* () {
    const purchase = yield* load;
    if (purchase?.status !== "pending_payment") return false;
    const created = yield* createUnlimitedPassHolds(purchase).pipe(
      Effect.as(true),
      Effect.catchTags({
        DotyposRejected: (failure) =>
          failure.operation === "createReservation" &&
          (failure.reason === "invalid-request" ||
            failure.reason === "not-found")
            ? Effect.succeed(false)
            : Effect.fail(failure),
        UnlimitedPassHoldsUnavailable: (failure) =>
          failure.reason === "changed"
            ? Effect.succeed(false)
            : Effect.fail(failure),
      })
    );
    if (!created) return false;
    return yield* reconfirmUnlimitedPassHolds(purchase).pipe(
      Effect.as(true),
      Effect.catchTag("UnlimitedPassHoldsUnavailable", (failure) =>
        failure.reason === "changed"
          ? Effect.succeed(false)
          : Effect.fail(failure)
      )
    );
  }).pipe(WorkspaceLockSections.passPurchaseFulfillment(orderId));
});
