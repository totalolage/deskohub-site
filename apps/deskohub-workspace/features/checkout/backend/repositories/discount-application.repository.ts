import { asc } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { equalsAny } from "@/db/equals-any";
import { discountApplications } from "@/db/schema";
import type { DiscountId } from "@/features/discounts";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type ReadLimitExceededError,
  readLimitSentinel,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";
import { type Money, moneyWithValue } from "@/shared/money/money";

/**
 * A discount applied to a payment attempt, as the customer may see it: the
 * label and amounts snapshotted when checkout committed the discount. Leaves
 * out the internal adjustment, product identity and provenance documents.
 * Discount-code claims (redemptions) are a separate record.
 */
export type CustomerDiscountApplicationRecord = {
  readonly workspaceReservationId: WorkspaceReservationId;
  /** Position of the application within its payment attempt, from 0. */
  readonly sequence: number;
  readonly publicDiscountId: DiscountId;
  readonly label: string;
  readonly subtotalBefore: Money;
  readonly appliedAmount: Money;
  readonly subtotalAfter: Money;
  readonly createdAt: Temporal.Instant;
};

export interface IDiscountApplicationRepository {
  /**
   * Every discount applied to payment attempts of the given reservations,
   * oldest first. The caller owns the reservations' customer scope and the
   * `limit`, which bounds the whole result: more matching applications fail
   * with `ReadLimitExceededError` and return nothing.
   */
  readonly listForReservations: (input: {
    readonly workspaceReservationIds: readonly WorkspaceReservationId[];
    readonly limit: number;
  }) => Effect.Effect<
    readonly CustomerDiscountApplicationRecord[],
    EffectDrizzleQueryError | ReadLimitExceededError
  >;
}

/**
 * Reads the discount applications checkout committed with payment attempts.
 * `PaymentLifecycleRepository` writes them.
 */
export class DiscountApplicationRepository extends Context.Service<
  DiscountApplicationRepository,
  IDiscountApplicationRepository
>()("@deskohub-workspace/checkout/DiscountApplicationRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const listForReservations = Effect.fn(
        "DiscountApplicationRepository.listForReservations"
      )(function* (input: {
        readonly workspaceReservationIds: readonly WorkspaceReservationId[];
        readonly limit: number;
      }) {
        if (input.workspaceReservationIds.length === 0) return [];

        const rows = yield* db
          .select({
            workspaceReservationId: discountApplications.workspaceReservationId,
            sequence: discountApplications.sequence,
            publicDiscountId: discountApplications.publicDiscountId,
            label: discountApplications.label,
            subtotalBeforeValue: discountApplications.subtotalBeforeValue,
            subtotalBeforeExponent: discountApplications.subtotalBeforeExponent,
            subtotalBeforeCurrency: discountApplications.subtotalBeforeCurrency,
            appliedAmountValue: discountApplications.appliedAmountValue,
            appliedAmountExponent: discountApplications.appliedAmountExponent,
            appliedAmountCurrency: discountApplications.appliedAmountCurrency,
            subtotalAfterValue: discountApplications.subtotalAfterValue,
            subtotalAfterExponent: discountApplications.subtotalAfterExponent,
            subtotalAfterCurrency: discountApplications.subtotalAfterCurrency,
            createdAt: discountApplications.createdAt,
          })
          .from(discountApplications)
          .where(
            equalsAny(
              discountApplications.workspaceReservationId,
              input.workspaceReservationIds
            )
          )
          .orderBy(
            asc(discountApplications.createdAt),
            asc(discountApplications.id)
          )
          .limit(readLimitSentinel(input.limit));
        const applications = yield* requireWithinReadLimit(rows, input.limit);

        return applications.map(
          (application): CustomerDiscountApplicationRecord => ({
            workspaceReservationId: application.workspaceReservationId,
            sequence: application.sequence,
            publicDiscountId: application.publicDiscountId,
            label: application.label,
            subtotalBefore: moneyWithValue(application.subtotalBeforeValue, {
              currency: application.subtotalBeforeCurrency,
              exponent: application.subtotalBeforeExponent,
            }),
            appliedAmount: moneyWithValue(application.appliedAmountValue, {
              currency: application.appliedAmountCurrency,
              exponent: application.appliedAmountExponent,
            }),
            subtotalAfter: moneyWithValue(application.subtotalAfterValue, {
              currency: application.subtotalAfterCurrency,
              exponent: application.subtotalAfterExponent,
            }),
            createdAt: application.createdAt,
          })
        );
      });

      return { listForReservations } satisfies IDiscountApplicationRepository;
    })
  );
}
