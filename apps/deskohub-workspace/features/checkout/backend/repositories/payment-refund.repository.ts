import type { NexiCorrelationId } from "@deskohub/nexi";
import { and, asc, eq, lt, ne, or } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { paymentAttempts, workspaceReservations } from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  isNexiPaymentAttempt,
  type NexiPaymentAttempt,
  toPaymentAttempt,
} from "./payment-attempt.repository";

/**
 * `recorded` stores a new or larger refund, `unchanged` means the attempt
 * already holds this refund total, and `not_applicable` means the attempt is
 * not a paid Nexi attempt that can carry a refund.
 */
export type PaymentRefundRecordResult =
  | "recorded"
  | "unchanged"
  | "not_applicable";

export interface RefundablePaymentAttempt {
  readonly attempt: NexiPaymentAttempt;
  readonly correlationId: NexiCorrelationId;
}

export interface IPaymentRefundRepository {
  /** Paid Nexi attempts whose refund is still outstanding, oldest first. */
  readonly findAwaitingRefund: (input: {
    readonly limit: number;
  }) => Effect.Effect<
    readonly RefundablePaymentAttempt[],
    EffectDrizzleQueryError
  >;
  /**
   * Records Nexi's successful refund total for a paid Nexi attempt. The total
   * only grows, so a stale or replayed provider read never lowers it.
   */
  readonly recordRefund: (input: {
    readonly id: PaymentAttemptId;
    readonly refundedAmountValue: number;
    readonly refundedAt: Temporal.Instant;
    readonly recordedAt: Temporal.Instant;
  }) => Effect.Effect<PaymentRefundRecordResult, EffectDrizzleQueryError>;
}

export class PaymentRefundRepository extends Context.Service<
  PaymentRefundRepository,
  IPaymentRefundRepository
>()("@deskohub-workspace/checkout/PaymentRefundRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findAwaitingRefund = Effect.fn(
        "PaymentRefundRepository.findAwaitingRefund"
      )(function* (input: { readonly limit: number }) {
        const rows = yield* db
          .select({
            attempt: paymentAttempts,
            correlationId: workspaceReservations.correlationId,
          })
          .from(paymentAttempts)
          .innerJoin(
            workspaceReservations,
            eq(workspaceReservations.id, paymentAttempts.workspaceReservationId)
          )
          .where(eq(paymentAttempts.refundState, "required"))
          .orderBy(asc(paymentAttempts.updatedAt), asc(paymentAttempts.id))
          .limit(input.limit);

        return rows.flatMap(({ attempt, correlationId }) => {
          const paymentAttempt = toPaymentAttempt(attempt);
          return isNexiPaymentAttempt(paymentAttempt)
            ? [{ attempt: paymentAttempt, correlationId }]
            : [];
        });
      });

      const recordRefund = Effect.fn("PaymentRefundRepository.recordRefund")(
        function* (input: {
          readonly id: PaymentAttemptId;
          readonly refundedAmountValue: number;
          readonly refundedAt: Temporal.Instant;
          readonly recordedAt: Temporal.Instant;
        }) {
          const [updated] = yield* db
            .update(paymentAttempts)
            .set({
              refundState: "refunded",
              refundedAmountValue: input.refundedAmountValue,
              refundedAt: input.refundedAt,
              updatedAt: input.recordedAt,
            })
            .where(
              and(
                eq(paymentAttempts.id, input.id),
                eq(paymentAttempts.provider, "nexi"),
                eq(paymentAttempts.state, "paid"),
                or(
                  ne(paymentAttempts.refundState, "refunded"),
                  lt(
                    paymentAttempts.refundedAmountValue,
                    input.refundedAmountValue
                  )
                )
              )
            )
            .returning({ id: paymentAttempts.id });
          if (updated) return "recorded" as const;

          const [existing] = yield* db
            .select({ refundState: paymentAttempts.refundState })
            .from(paymentAttempts)
            .where(eq(paymentAttempts.id, input.id))
            .limit(1);
          return existing?.refundState === "refunded"
            ? ("unchanged" as const)
            : ("not_applicable" as const);
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
      );

      return { findAwaitingRefund, recordRefund };
    })
  );
}
