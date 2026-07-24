import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type PaymentAttemptRow,
  type PaymentState,
  paymentAttempts,
} from "@/db/schema";

export const toPaymentAttempt = (attempt: PaymentAttemptRow) => {
  const { amountExponent, amountValue, currency, ...paymentAttempt } = attempt;

  return {
    ...paymentAttempt,
    amount: {
      value: amountValue,
      exponent: amountExponent,
      currency,
    },
  };
};

export type PaymentAttempt = ReturnType<typeof toPaymentAttempt>;

export interface IPaymentAttemptRepository {
  readonly findById: (
    id: string
  ) => Effect.Effect<PaymentAttempt | null, EffectDrizzleQueryError>;
  readonly findByProviderOrderId: (
    providerOrderId: string
  ) => Effect.Effect<PaymentAttempt | null, EffectDrizzleQueryError>;
  readonly findDisplayableForReservation: (input: {
    readonly workspaceReservationId: string;
    readonly activePaymentAttemptId?: string;
    readonly paymentState: PaymentState;
  }) => Effect.Effect<PaymentAttempt | null, EffectDrizzleQueryError>;
}

export class PaymentAttemptRepository extends Context.Service<
  PaymentAttemptRepository,
  IPaymentAttemptRepository
>()("@deskohub-workspace/checkout/PaymentAttemptRepository") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findById = Effect.fn("PaymentAttemptRepository.findById")(
        function* (id: string) {
          const [attempt] = yield* db
            .select()
            .from(paymentAttempts)
            .where(eq(paymentAttempts.id, id))
            .limit(1);
          return attempt ? toPaymentAttempt(attempt) : null;
        }
      );

      const findByProviderOrderId = Effect.fn(
        "PaymentAttemptRepository.findByProviderOrderId"
      )(function* (providerOrderId: string) {
        const [attempt] = yield* db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.providerOrderId, providerOrderId))
          .limit(1);
        return attempt ? toPaymentAttempt(attempt) : null;
      });

      const findDisplayableForReservation = Effect.fn(
        "PaymentAttemptRepository.findDisplayableForReservation"
      )(function* (input: {
        readonly workspaceReservationId: string;
        readonly activePaymentAttemptId?: string;
        readonly paymentState: PaymentState;
      }) {
        const [attempt] = yield* db
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
                  eq(paymentAttempts.id, input.activePaymentAttemptId ?? ""),
                  inArray(paymentAttempts.state, ["created", "pending", "paid"])
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
        return attempt ? toPaymentAttempt(attempt) : null;
      });

      return {
        findById,
        findByProviderOrderId,
        findDisplayableForReservation,
      } satisfies IPaymentAttemptRepository;
    })
  );
}

export const PaymentAttemptRepositoryLive = PaymentAttemptRepository.Live;
