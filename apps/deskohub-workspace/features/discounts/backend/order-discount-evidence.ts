import "server-only";

import { isDeepStrictEqual } from "node:util";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { Data, Effect, Match, Option, Schema } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
  orderLines,
  orders,
  promotionCodeCustomers,
  promotionCodes,
  voucherRedemptionAppliedAmountValue,
  voucherRedemptions,
  vouchers,
} from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  workspaceProductIdentityEquals,
  workspaceProductIdentitySchema,
} from "@/features/checkout/product-identity";
import {
  type WorkspaceMoney,
  workspaceMoneyEquals,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import {
  type DiscountCommitmentPayload,
  type GoodsBasketDiscountCommitment,
  type GoodsBasketDiscountCommitmentPayload,
  getGoodsBasketDiscountCommitmentPayload,
} from "@/features/discounts/commitment";
import {
  type AppliedDiscount,
  type DiscountAdjustment,
  discountAdjustmentSchema,
} from "@/features/discounts/contracts";
import { decodeDiscountDefinition } from "@/features/discounts/discount-definition";
import { DiscountClaimError } from "@/features/discounts/errors";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import type { DiscountApplicationId } from "@/features/discounts/persistence-contracts";
import { workspaceProductTargetMatches } from "@/features/discounts/product-target";
import { getPromotionTiming } from "@/features/discounts/promotion-code";
import type { DiscountClaimInstruction } from "@/features/discounts/provider";
import { type Locale, m } from "@/features/i18n";
import type { OrderId } from "@/features/order";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

export type DiscountEvidenceTransaction = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

export type DiscountEvidenceOwner =
  | {
      readonly kind: "reservation_attempt";
      readonly orderId: OrderId;
      readonly paymentAttemptId: PaymentAttemptId;
      readonly workspaceReservationId: WorkspaceReservationId;
    }
  | {
      readonly kind: "issued_goods";
      readonly orderId: OrderId;
    };

export type PersistedDiscountApplication = {
  readonly id: DiscountApplicationId;
  readonly sequence: number;
};

export type DiscountClaimOwnership =
  | {
      readonly kind: "reservation_attempt";
      readonly paymentAttemptId: PaymentAttemptId;
      readonly reservationExpiresAt: Temporal.Instant;
    }
  | {
      readonly kind: "issued_goods";
      readonly issuedAt: Temporal.Instant;
    };

export type ClaimedDiscountApplication = {
  readonly index: number;
  readonly application: AppliedDiscount;
  readonly claim: DiscountClaimInstruction;
};

type DiscountApplicationEvidence = {
  readonly application: AppliedDiscount;
  readonly product: DiscountCommitmentPayload["product"];
  readonly provenance: DiscountCommitmentPayload["applications"][number]["provenance"];
};

type ClaimedGoodsBasketDiscountApplication = {
  readonly application: AppliedDiscount;
  readonly appliedAmount: WorkspaceMoney;
  readonly claim: DiscountClaimInstruction;
  readonly products: readonly DiscountCommitmentPayload["product"][];
};

export const validateOrderDiscountCommitment = Effect.fn(
  "OrderDiscountEvidence.validateCommitment"
)(function* (commitment: DiscountCommitmentPayload) {
  const claimedApplicationIndex = commitment.applications.findIndex(
    ({ claim }) => claim !== undefined
  );

  if (
    claimedApplicationIndex >= 0 &&
    commitment.applications.some(
      ({ claim }, index) =>
        index > claimedApplicationIndex && claim !== undefined
    )
  ) {
    return yield* new DiscountClaimError({
      operation: "reserve",
      reason: "claim_conflict",
      message: "An order can consume at most one promotion claim.",
    });
  }

  for (const { application, claim } of commitment.applications) {
    yield* validateAppliedDiscountMoney(application, claim);

    if (
      claim?.kind === "discount_code" &&
      !workspaceProductIdentityEquals(claim.product, commitment.product)
    ) {
      return yield* claimError(
        "reserve",
        "product_ineligible",
        "The discount-code claim targets a different product.",
        claim
      );
    }
  }

  if (claimedApplicationIndex < 0) return undefined;

  const claimedApplication = commitment.applications[claimedApplicationIndex];
  if (!claimedApplication?.claim) return undefined;

  return {
    index: claimedApplicationIndex,
    application: claimedApplication.application,
    claim: claimedApplication.claim,
  } satisfies ClaimedDiscountApplication;
});

export const persistOrderDiscountApplications = Effect.fn(
  "OrderDiscountEvidence.persistApplications"
)(function* (input: {
  readonly tx: DiscountEvidenceTransaction;
  readonly commitment: DiscountCommitmentPayload;
  readonly owner: DiscountEvidenceOwner;
}) {
  if (input.commitment.applications.length === 0) {
    return [] satisfies PersistedDiscountApplication[];
  }

  return yield* persistDiscountApplicationRows({
    tx: input.tx,
    owner: input.owner,
    applications: input.commitment.applications.map(
      ({ application, provenance }) => ({
        application,
        product: input.commitment.product,
        provenance,
      })
    ),
  });
});

const persistDiscountApplicationRows = Effect.fn(
  "OrderDiscountEvidence.persistApplicationRows"
)(function* (input: {
  readonly tx: DiscountEvidenceTransaction;
  readonly applications: readonly DiscountApplicationEvidence[];
  readonly owner: DiscountEvidenceOwner;
}) {
  if (input.applications.length === 0) {
    return [] satisfies PersistedDiscountApplication[];
  }

  return yield* input.tx
    .insert(discountApplications)
    .values(
      input.applications.map(
        ({ application, product, provenance }, sequence) => ({
          orderId: input.owner.orderId,
          paymentAttemptId:
            input.owner.kind === "reservation_attempt"
              ? input.owner.paymentAttemptId
              : null,
          workspaceReservationId:
            input.owner.kind === "reservation_attempt"
              ? input.owner.workspaceReservationId
              : null,
          sequence,
          publicDiscountId: application.discount.id,
          label: application.discount.label,
          adjustment: application.discount.adjustment,
          productIdentity: product,
          subtotalBeforeValue: application.subtotalBefore.value,
          subtotalBeforeExponent: application.subtotalBefore.exponent,
          subtotalBeforeCurrency: application.subtotalBefore.currency,
          appliedAmountValue: application.amount.value,
          appliedAmountExponent: application.amount.exponent,
          appliedAmountCurrency: application.amount.currency,
          subtotalAfterValue: application.subtotalAfter.value,
          subtotalAfterExponent: application.subtotalAfter.exponent,
          subtotalAfterCurrency: application.subtotalAfter.currency,
          expiresAt: application.discount.expiresAt
            ? Temporal.Instant.from(application.discount.expiresAt)
            : null,
          countdownStartsAt: application.discount.countdownStartsAt
            ? Temporal.Instant.from(application.discount.countdownStartsAt)
            : null,
          provenance,
        })
      )
    )
    .returning({
      id: discountApplications.id,
      sequence: discountApplications.sequence,
    });
});

export class OrderDiscountEvidenceStateError extends Data.TaggedError(
  "OrderDiscountEvidenceStateError"
)<{
  readonly orderId: OrderId;
  readonly message: string;
}> {}

export const persistIssuedGoodsDiscountEvidence = Effect.fn(
  "OrderDiscountEvidence.persistIssuedGoods"
)(function* (input: {
  readonly tx: DiscountEvidenceTransaction;
  readonly orderId: OrderId;
  readonly commitment: GoodsBasketDiscountCommitment;
  readonly locale: Locale;
  readonly issuedAt: Temporal.Instant;
}) {
  const commitment = getGoodsBasketDiscountCommitmentPayload(input.commitment);

  const [order] = yield* input.tx
    .select({
      dotyposCustomerId: orders.dotyposCustomerId,
      fulfilledAt: orders.fulfilledAt,
      kind: orders.kind,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1)
    .for("update");
  if (
    !order ||
    order.kind !== "goods" ||
    !order.fulfilledAt ||
    Temporal.Instant.compare(order.fulfilledAt, input.issuedAt) !== 0
  ) {
    return yield* new OrderDiscountEvidenceStateError({
      orderId: input.orderId,
      message: "Issued-goods discount evidence requires a goods order.",
    });
  }

  const lines = yield* input.tx
    .select({
      sequence: orderLines.sequence,
      productIdentity: orderLines.productIdentity,
      undiscountedTotalValue: orderLines.undiscountedTotalValue,
      payableTotalValue: orderLines.payableTotalValue,
      amountExponent: orderLines.amountExponent,
      currency: orderLines.currency,
    })
    .from(orderLines)
    .where(eq(orderLines.orderId, input.orderId))
    .orderBy(orderLines.sequence)
    .for("update");
  const validated = yield* validateIssuedGoodsBasketDiscountCommitment({
    commitment,
    lines,
  });

  const storedApplicationRows = yield* input.tx
    .select()
    .from(discountApplications)
    .where(
      and(
        eq(discountApplications.orderId, input.orderId),
        isNull(discountApplications.paymentAttemptId)
      )
    )
    .orderBy(discountApplications.sequence);

  if (
    storedApplicationRows.length > 0 &&
    !storedApplicationsMatchEvidence(
      storedApplicationRows,
      validated.applications
    )
  ) {
    return yield* new OrderDiscountEvidenceStateError({
      orderId: input.orderId,
      message: "Issued discount evidence conflicts with the stored order.",
    });
  }

  const persistedRows =
    storedApplicationRows.length === 0
      ? yield* persistDiscountApplicationRows({
          tx: input.tx,
          applications: validated.applications,
          owner: { kind: "issued_goods", orderId: input.orderId },
        })
      : storedApplicationRows.map(({ id, sequence }) => ({ id, sequence }));

  const [existingDiscountClaims, existingVoucherClaims] = yield* Effect.all([
    input.tx
      .select({
        applicationId: discountCodeRedemptions.applicationId,
        appliedAmountValue: discountCodeRedemptions.appliedAmountValue,
        codeId: discountCodeRedemptions.codeId,
        dotyposCustomerId: discountCodeRedemptions.dotyposCustomerId,
        redeemedAt: discountCodeRedemptions.redeemedAt,
        reservedAt: discountCodeRedemptions.reservedAt,
        state: discountCodeRedemptions.state,
      })
      .from(discountCodeRedemptions)
      .where(
        and(
          eq(discountCodeRedemptions.orderId, input.orderId),
          isNull(discountCodeRedemptions.paymentAttemptId)
        )
      )
      .limit(1),
    input.tx
      .select({
        applicationId: voucherRedemptions.applicationId,
        appliedAmountValue: voucherRedemptions.appliedAmountValue,
        voucherId: voucherRedemptions.voucherId,
        dotyposCustomerId: voucherRedemptions.dotyposCustomerId,
        redeemedAt: voucherRedemptions.redeemedAt,
        reservedAt: voucherRedemptions.reservedAt,
        state: voucherRedemptions.state,
      })
      .from(voucherRedemptions)
      .where(
        and(
          eq(voucherRedemptions.orderId, input.orderId),
          isNull(voucherRedemptions.paymentAttemptId)
        )
      )
      .limit(1),
  ]);
  const claimedApplication = validated.claimedApplication;
  if (!claimedApplication) {
    if (existingDiscountClaims[0] || existingVoucherClaims[0]) {
      return yield* new OrderDiscountEvidenceStateError({
        orderId: input.orderId,
        message: "Issued promotion claim conflicts with the stored order.",
      });
    }
    return persistedRows;
  }
  if (existingDiscountClaims[0] || existingVoucherClaims[0]) {
    const existing =
      claimedApplication.claim.kind === "discount_code"
        ? existingDiscountClaims[0]
        : existingVoucherClaims[0];
    const expectedClaimId =
      claimedApplication.claim.kind === "discount_code"
        ? claimedApplication.claim.codeId
        : claimedApplication.claim.voucherId;
    let actualClaimId: typeof expectedClaimId | undefined;
    if (existing) {
      actualClaimId =
        "codeId" in existing ? existing.codeId : existing.voucherId;
    }
    if (
      !existing ||
      existingDiscountClaims.length + existingVoucherClaims.length !== 1 ||
      existing.applicationId !== null ||
      existing.appliedAmountValue !== claimedApplication.appliedAmount.value ||
      existing.dotyposCustomerId !== order.dotyposCustomerId ||
      existing.state !== "redeemed" ||
      existing.reservedAt.toString() !== input.issuedAt.toString() ||
      existing.redeemedAt?.toString() !== input.issuedAt.toString() ||
      actualClaimId !== expectedClaimId
    ) {
      return yield* new OrderDiscountEvidenceStateError({
        orderId: input.orderId,
        message: "Issued promotion claim conflicts with the stored order.",
      });
    }
    return persistedRows;
  }

  yield* admitOrderDiscountClaim({
    tx: input.tx,
    claim: claimedApplication.claim,
    application: claimedApplication.application,
    products: claimedApplication.products,
    appliedAmount: claimedApplication.appliedAmount,
    applicationId: null,
    orderId: input.orderId,
    ownership: { kind: "issued_goods", issuedAt: input.issuedAt },
    locale: input.locale,
    orderCustomerId: order.dotyposCustomerId,
  });
  return persistedRows;
});

export const validateIssuedGoodsBasketDiscountCommitment = Effect.fn(
  "OrderDiscountEvidence.validateIssuedGoodsBasket"
)(function* (input: {
  readonly commitment: GoodsBasketDiscountCommitmentPayload;
  readonly lines: readonly {
    readonly sequence: number;
    readonly productIdentity: unknown;
    readonly undiscountedTotalValue: number;
    readonly payableTotalValue: number;
    readonly amountExponent: number;
    readonly currency: string;
  }[];
}) {
  const claims = input.commitment.applications.flatMap(({ claim }) =>
    claim ? [claim] : []
  );
  if (claims.length > 1) {
    return yield* claimError(
      "redeem",
      "claim_conflict",
      "An order can consume at most one promotion claim.",
      claims[1]
    );
  }
  if (
    input.lines.length === 0 ||
    input.lines.length !== input.commitment.lines.length
  ) {
    return yield* goodsMoneyMismatch(claims[0]);
  }

  const storedProducts: DiscountCommitmentPayload["product"][] = [];
  for (const [index, line] of input.lines.entries()) {
    const product = Option.getOrUndefined(
      Schema.decodeUnknownOption(workspaceProductIdentitySchema, {
        onExcessProperty: "error",
      })(line.productIdentity)
    );
    const committedLine = input.commitment.lines[index];
    if (
      !product ||
      product.kind !== "goods" ||
      !committedLine ||
      committedLine.product.kind !== "goods" ||
      line.sequence !== index ||
      !workspaceProductIdentityEquals(product, committedLine.product)
    ) {
      return yield* claimError(
        "redeem",
        "product_ineligible",
        "A committed goods product does not match its issued order line.",
        claims[0]
      );
    }
    if (
      !moneyMatchesLine(
        committedLine.undiscountedSubtotal,
        line.undiscountedTotalValue,
        line
      ) ||
      !moneyMatchesLine(
        committedLine.payableSubtotal,
        line.payableTotalValue,
        line
      )
    ) {
      return yield* goodsMoneyMismatch(claims[0]);
    }
    storedProducts.push(product);
  }

  const firstLine = input.lines[0]!;
  const undiscountedTotal = input.lines.reduce(
    (total, line) => total + BigInt(line.undiscountedTotalValue),
    0n
  );
  const payableTotal = input.lines.reduce(
    (total, line) => total + BigInt(line.payableTotalValue),
    0n
  );
  const committedLineUndiscountedTotal = input.commitment.lines.reduce(
    (total, line) => total + BigInt(line.undiscountedSubtotal.value),
    0n
  );
  const committedLinePayableTotal = input.commitment.lines.reduce(
    (total, line) => total + BigInt(line.payableSubtotal.value),
    0n
  );
  if (
    !moneyMatchesLine(
      input.commitment.undiscountedTotal,
      Number(undiscountedTotal),
      firstLine
    ) ||
    !moneyMatchesLine(
      input.commitment.payableTotal,
      Number(payableTotal),
      firstLine
    ) ||
    BigInt(input.commitment.undiscountedTotal.value) !==
      committedLineUndiscountedTotal ||
    BigInt(input.commitment.payableTotal.value) !== committedLinePayableTotal ||
    input.lines.some(
      (line) =>
        line.currency !== firstLine.currency ||
        line.amountExponent !== firstLine.amountExponent
    )
  ) {
    return yield* goodsMoneyMismatch(claims[0]);
  }

  const remaining = input.lines.map(({ undiscountedTotalValue }) =>
    BigInt(undiscountedTotalValue)
  );
  const applications: DiscountApplicationEvidence[] = [];
  let totalApplied = 0n;
  let claimedApplication: ClaimedGoodsBasketDiscountApplication | undefined;

  for (const candidate of input.commitment.applications) {
    const lineApplications = candidate.lineApplications.toSorted(
      (left, right) => left.lineIndex - right.lineIndex
    );
    const firstApplication = lineApplications[0]?.application;
    if (!firstApplication) return yield* goodsMoneyMismatch(candidate.claim);

    const seenLineIndexes = new Set<number>();
    let candidateApplied = 0n;
    for (const lineApplication of lineApplications) {
      const line = input.lines[lineApplication.lineIndex];
      const storedProduct = storedProducts[lineApplication.lineIndex];
      if (
        !line ||
        !storedProduct ||
        seenLineIndexes.has(lineApplication.lineIndex) ||
        !workspaceProductIdentityEquals(
          lineApplication.product,
          storedProduct
        ) ||
        !discountApplicationMetadataEquals(
          lineApplication.application,
          firstApplication
        )
      ) {
        return yield* claimError(
          "redeem",
          "product_ineligible",
          "A committed discount allocation does not match its goods line.",
          candidate.claim
        );
      }
      seenLineIndexes.add(lineApplication.lineIndex);
      yield* validateAppliedDiscountMoney(
        lineApplication.application,
        candidate.claim
      );
      if (
        !moneyMatchesLine(
          lineApplication.application.subtotalBefore,
          Number(remaining[lineApplication.lineIndex]),
          line
        )
      ) {
        return yield* goodsMoneyMismatch(candidate.claim);
      }

      remaining[lineApplication.lineIndex] = BigInt(
        lineApplication.application.subtotalAfter.value
      );
      candidateApplied += BigInt(lineApplication.application.amount.value);
      totalApplied += BigInt(lineApplication.application.amount.value);
      applications.push({
        application: lineApplication.application,
        product: lineApplication.product,
        provenance: candidate.provenance,
      });
    }

    const candidateClaim = candidate.claim;
    if (candidateClaim) {
      if (
        candidateClaim.kind === "discount_code" &&
        !lineApplications.some(({ product }) =>
          workspaceProductIdentityEquals(product, candidateClaim.product)
        )
      ) {
        return yield* claimError(
          "redeem",
          "product_ineligible",
          "The discount-code claim does not identify an allocated product.",
          candidateClaim
        );
      }
      if (candidateApplied > BigInt(Number.MAX_SAFE_INTEGER)) {
        return yield* goodsMoneyMismatch(candidateClaim);
      }
      claimedApplication = {
        application: firstApplication,
        appliedAmount: workspaceMoneyWithValue(
          Number(candidateApplied),
          firstApplication.amount
        ),
        claim: candidateClaim,
        products: lineApplications.map(({ product }) => product),
      };
    }
  }

  if (
    input.lines.some(
      (line, index) => remaining[index] !== BigInt(line.payableTotalValue)
    ) ||
    undiscountedTotal - payableTotal !== totalApplied
  ) {
    return yield* goodsMoneyMismatch(claims[0]);
  }

  return { applications, claimedApplication };
});

const moneyMatchesLine = (
  money: WorkspaceMoney,
  value: number,
  line: { readonly amountExponent: number; readonly currency: string }
) =>
  Number.isSafeInteger(value) &&
  money.value === value &&
  money.exponent === line.amountExponent &&
  money.currency === line.currency;

const goodsMoneyMismatch = (claim?: DiscountClaimInstruction) =>
  claimError(
    "redeem",
    "money_mismatch",
    "The basket discount commitment does not reconcile with the order.",
    claim
  );

const discountApplicationMetadataEquals = (
  left: AppliedDiscount,
  right: AppliedDiscount
) =>
  left.discount.id === right.discount.id &&
  left.discount.label === right.discount.label &&
  discountAdjustmentsEqual(
    left.discount.adjustment,
    right.discount.adjustment
  ) &&
  left.discount.expiresAt === right.discount.expiresAt &&
  left.discount.countdownStartsAt === right.discount.countdownStartsAt;

export const admitOrderDiscountClaim = Effect.fn(
  "OrderDiscountEvidence.admitClaim"
)(function* (input: {
  readonly tx: DiscountEvidenceTransaction;
  readonly claim: DiscountClaimInstruction;
  readonly application: AppliedDiscount;
  readonly products?: readonly DiscountCommitmentPayload["product"][];
  readonly appliedAmount?: WorkspaceMoney;
  readonly applicationId: DiscountApplicationId | null;
  readonly orderId: OrderId;
  readonly ownership: DiscountClaimOwnership;
  readonly locale: Locale;
  readonly orderCustomerId: DotyposCustomerId;
}) {
  if (
    (input.ownership.kind === "reservation_attempt" &&
      input.applicationId === null) ||
    (input.ownership.kind === "issued_goods" &&
      (input.applicationId !== null || !input.appliedAmount))
  ) {
    return yield* claimError(
      "reserve",
      "claim_conflict",
      "The promotion claim ownership is inconsistent.",
      input.claim
    );
  }
  if (input.orderCustomerId !== input.claim.dotyposCustomerId) {
    return yield* claimError(
      "reserve",
      "customer_ineligible",
      "The discount-code claim customer does not match the order.",
      input.claim
    );
  }

  const stored = yield* Match.value(input.claim).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: (claim) =>
        Effect.gen(function* () {
          const rows = yield* input.tx
            .select({ promotion: promotionCodes, code: discountCodes })
            .from(discountCodes)
            .innerJoin(
              promotionCodes,
              eq(promotionCodes.id, discountCodes.promotionCodeId)
            )
            .where(eq(discountCodes.id, claim.codeId))
            .limit(1)
            .for("update");
          return rows[0]
            ? ({ kind: "discount_code", claim, ...rows[0] } as const)
            : undefined;
        }),
      voucher: (claim) =>
        Effect.gen(function* () {
          const rows = yield* input.tx
            .select({ promotion: promotionCodes, voucher: vouchers })
            .from(vouchers)
            .innerJoin(
              promotionCodes,
              eq(promotionCodes.id, vouchers.promotionCodeId)
            )
            .where(eq(vouchers.id, claim.voucherId))
            .limit(1)
            .for("update");
          return rows[0]
            ? ({ kind: "voucher", claim, ...rows[0] } as const)
            : undefined;
        }),
    })
  );

  if (
    !stored ||
    (stored.kind === "discount_code" &&
      stored.code.discountId !== stored.claim.storedDiscountId)
  ) {
    return yield* claimError(
      "reserve",
      "unknown_code",
      "The accepted promotion no longer exists.",
      input.claim
    );
  }
  if (!stored.promotion.enabled) {
    return yield* claimError(
      "reserve",
      "inactive",
      "The accepted promotion is inactive.",
      input.claim
    );
  }

  const claimedAt =
    input.ownership.kind === "issued_goods"
      ? input.ownership.issuedAt
      : Temporal.Now.instant();
  if (
    input.ownership.kind === "reservation_attempt" &&
    Temporal.Instant.compare(input.ownership.reservationExpiresAt, claimedAt) <=
      0
  ) {
    return yield* claimError(
      "reserve",
      "claim_conflict",
      "Discount claims can only be reserved for a current held reservation.",
      input.claim
    );
  }
  if (
    stored.promotion.validFrom &&
    Temporal.Instant.compare(claimedAt, stored.promotion.validFrom) < 0
  ) {
    return yield* claimError(
      "reserve",
      "not_started",
      "The accepted promotion is not valid yet.",
      input.claim
    );
  }
  if (
    stored.promotion.validUntil &&
    Temporal.Instant.compare(claimedAt, stored.promotion.validUntil) >= 0
  ) {
    return yield* claimError(
      "reserve",
      "expired",
      "The accepted promotion has expired.",
      input.claim
    );
  }

  const [allowlist] = yield* input.tx
    .select({ count: count() })
    .from(promotionCodeCustomers)
    .where(eq(promotionCodeCustomers.promotionCodeId, stored.promotion.id));
  if ((allowlist?.count ?? 0) > 0) {
    const [customer] = yield* input.tx
      .select({ promotionCodeId: promotionCodeCustomers.promotionCodeId })
      .from(promotionCodeCustomers)
      .where(
        and(
          eq(promotionCodeCustomers.promotionCodeId, stored.promotion.id),
          eq(
            promotionCodeCustomers.dotyposCustomerId,
            input.claim.dotyposCustomerId
          )
        )
      )
      .limit(1);
    if (!customer) {
      return yield* claimError(
        "reserve",
        "customer_ineligible",
        "The customer is no longer eligible for the accepted promotion.",
        input.claim
      );
    }
  }

  yield* Match.value(stored).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: ({ claim, code, promotion }) =>
        validateStoredDiscountClaim({
          ...input,
          claim,
          code,
          promotion,
          products: input.products ?? [claim.product],
        }),
      voucher: ({ claim, voucher, promotion }) =>
        validateVoucherClaim({
          ...input,
          claim,
          voucher,
          promotion,
          appliedAmount: input.appliedAmount ?? input.application.amount,
        }),
    })
  );

  if (stored.kind === "discount_code") {
    const [customerUses] = yield* input.tx
      .select({ count: count() })
      .from(discountCodeRedemptions)
      .where(
        and(
          eq(discountCodeRedemptions.codeId, stored.code.id),
          eq(
            discountCodeRedemptions.dotyposCustomerId,
            input.claim.dotyposCustomerId
          ),
          inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
        )
      );
    if (
      stored.code.maxUsesPerCustomer !== null &&
      (customerUses?.count ?? 0) >= stored.code.maxUsesPerCustomer
    ) {
      return yield* claimError(
        "reserve",
        "usage_limit_reached",
        "The customer has no remaining uses for this discount code.",
        input.claim
      );
    }
  } else {
    const [customerUse] = yield* input.tx
      .select({ state: voucherRedemptions.state })
      .from(voucherRedemptions)
      .where(
        and(
          eq(voucherRedemptions.voucherId, stored.voucher.id),
          eq(
            voucherRedemptions.dotyposCustomerId,
            input.claim.dotyposCustomerId
          ),
          eq(voucherRedemptions.state, "reserved")
        )
      )
      .limit(1);
    if (customerUse) {
      return yield* claimError(
        "reserve",
        "claim_conflict",
        "The customer already has an active claim for this voucher.",
        input.claim
      );
    }
  }

  if (stored.kind === "discount_code" && stored.code.maxUses !== null) {
    const [uses] = yield* input.tx
      .select({ count: count() })
      .from(discountCodeRedemptions)
      .where(
        and(
          eq(discountCodeRedemptions.codeId, stored.code.id),
          inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
        )
      );

    if ((uses?.count ?? 0) >= stored.code.maxUses) {
      return yield* claimError(
        "reserve",
        "usage_limit_reached",
        "The accepted discount code has no remaining uses.",
        input.claim
      );
    }
  }

  const claimValues = {
    applicationId: input.applicationId,
    appliedAmountValue:
      input.ownership.kind === "issued_goods"
        ? input.appliedAmount?.value
        : null,
    orderId: input.orderId,
    paymentAttemptId:
      input.ownership.kind === "reservation_attempt"
        ? input.ownership.paymentAttemptId
        : null,
    dotyposCustomerId: input.claim.dotyposCustomerId,
    state:
      input.ownership.kind === "reservation_attempt"
        ? ("reserved" as const)
        : ("redeemed" as const),
    reservationExpiresAt:
      input.ownership.kind === "reservation_attempt"
        ? input.ownership.reservationExpiresAt
        : null,
    reservedAt: claimedAt,
    redeemedAt: input.ownership.kind === "issued_goods" ? claimedAt : null,
    updatedAt: claimedAt,
  };
  yield* Match.value(stored).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount_code: ({ code }) =>
        input.tx
          .insert(discountCodeRedemptions)
          .values({
            ...claimValues,
            codeId: code.id,
          })
          .pipe(Effect.asVoid),
      voucher: ({ voucher }) =>
        input.tx
          .insert(voucherRedemptions)
          .values({
            ...claimValues,
            voucherId: voucher.id,
          })
          .pipe(Effect.asVoid),
    })
  );
  return claimedAt;
});

const validateStoredDiscountClaim = Effect.fn(
  "PaymentLifecycle.validateStoredDiscountClaim"
)(function* (input: {
  readonly tx: DiscountEvidenceTransaction;
  readonly claim: Extract<
    DiscountClaimInstruction,
    { readonly kind: "discount_code" }
  >;
  readonly code: typeof discountCodes.$inferSelect;
  readonly promotion: typeof promotionCodes.$inferSelect;
  readonly application: AppliedDiscount;
  readonly locale: Locale;
  readonly products: readonly DiscountCommitmentPayload["product"][];
}) {
  const [definition] = yield* input.tx
    .select()
    .from(discounts)
    .where(eq(discounts.id, input.claim.storedDiscountId))
    .limit(1)
    .for("update");
  if (!definition) {
    return yield* claimError(
      "reserve",
      "unknown_code",
      "The accepted discount benefit no longer exists.",
      input.claim
    );
  }

  const targets = yield* input.tx
    .select({
      discountId: discountProductTargets.discountId,
      productTarget: discountProductTargets.productTarget,
    })
    .from(discountProductTargets)
    .where(eq(discountProductTargets.discountId, input.claim.storedDiscountId))
    .for("update");

  const currentDefinition = yield* decodeDiscountDefinition({
    row: {
      ...definition,
      productTargets: targets,
    },
  }).pipe(
    Effect.mapError(
      (cause) =>
        new DiscountClaimError({
          operation: "reserve",
          reason: "malformed_configuration",
          message: "The accepted discount benefit is malformed.",
          codeId: input.claim.codeId,
          cause,
        })
    )
  );
  if (
    !input.products.every((product) =>
      currentDefinition.products.some((productTarget) =>
        workspaceProductTargetMatches(productTarget, product)
      )
    )
  ) {
    return yield* claimError(
      "reserve",
      "product_ineligible",
      "The accepted discount code no longer targets this product.",
      input.claim
    );
  }
  const timing = getPromotionTiming(input.promotion.validUntil);
  if (
    !discountAdjustmentsEqual(
      currentDefinition.adjustment,
      input.application.discount.adjustment
    ) ||
    currentDefinition.labels[input.locale] !==
      input.application.discount.label ||
    timing.expiresAt !== input.application.discount.expiresAt ||
    timing.countdownStartsAt !== input.application.discount.countdownStartsAt
  ) {
    return yield* claimError(
      "reserve",
      "claim_conflict",
      "The accepted discount benefit changed before claim admission.",
      input.claim
    );
  }
});

const validateVoucherClaim = Effect.fn("PaymentLifecycle.validateVoucherClaim")(
  function* (input: {
    readonly tx: DiscountEvidenceTransaction;
    readonly claim: Extract<
      DiscountClaimInstruction,
      { readonly kind: "voucher" }
    >;
    readonly voucher: typeof vouchers.$inferSelect;
    readonly promotion: typeof promotionCodes.$inferSelect;
    readonly application: AppliedDiscount;
    readonly appliedAmount: WorkspaceMoney;
    readonly locale: Locale;
  }) {
    const [usage] = yield* input.tx
      .select({
        value: sql<number>`coalesce(sum(${voucherRedemptionAppliedAmountValue}), 0)::integer`,
      })
      .from(voucherRedemptions)
      .leftJoin(
        discountApplications,
        eq(discountApplications.id, voucherRedemptions.applicationId)
      )
      .where(
        and(
          eq(voucherRedemptions.voucherId, input.claim.voucherId),
          inArray(voucherRedemptions.state, ["reserved", "redeemed"])
        )
      );
    const availableAmount = {
      value: input.voucher.issuedAmountValue - (usage?.value ?? 0),
      exponent: input.voucher.issuedAmountExponent,
      currency: input.voucher.issuedAmountCurrency,
    };
    const adjustment = input.application.discount.adjustment;
    const timing = getPromotionTiming(input.promotion.validUntil);
    const discountId = deriveOpaqueDiscountId({
      providerNamespace: "database-voucher",
      providerReference: input.claim.voucherId,
    });
    if (
      !workspaceMoneyEquals(availableAmount, input.claim.availableAmount) ||
      adjustment.kind !== "fixed" ||
      !workspaceMoneyEquals(adjustment.amount, availableAmount) ||
      !workspaceMoneyEquals(
        workspaceMoneyWithValue(
          input.appliedAmount.value,
          input.application.amount
        ),
        input.appliedAmount
      ) ||
      input.appliedAmount.value > availableAmount.value ||
      input.application.discount.id !== discountId ||
      input.application.discount.label !==
        m.checkoutVoucherLabel({}, { locale: input.locale }) ||
      timing.expiresAt !== input.application.discount.expiresAt ||
      timing.countdownStartsAt !== input.application.discount.countdownStartsAt
    ) {
      return yield* claimError(
        "reserve",
        "claim_conflict",
        "The accepted voucher credit changed before claim admission.",
        input.claim
      );
    }
  }
);

const repairAttemptEvidenceOrder = Effect.fn(
  "OrderDiscountEvidence.repairAttemptOrder"
)(function* (input: {
  readonly tx: DiscountEvidenceTransaction;
  readonly orderId: OrderId;
  readonly paymentAttemptId: PaymentAttemptId;
}) {
  yield* Effect.all([
    input.tx
      .update(discountApplications)
      .set({ orderId: input.orderId })
      .where(
        and(
          eq(discountApplications.paymentAttemptId, input.paymentAttemptId),
          isNull(discountApplications.orderId)
        )
      ),
    input.tx
      .update(discountCodeRedemptions)
      .set({ orderId: input.orderId })
      .where(
        and(
          eq(discountCodeRedemptions.paymentAttemptId, input.paymentAttemptId),
          isNull(discountCodeRedemptions.orderId)
        )
      ),
    input.tx
      .update(voucherRedemptions)
      .set({ orderId: input.orderId })
      .where(
        and(
          eq(voucherRedemptions.paymentAttemptId, input.paymentAttemptId),
          isNull(voucherRedemptions.orderId)
        )
      ),
  ]).pipe(Effect.asVoid);
});

export const redeemAttemptDiscountClaim = Effect.fn(
  "OrderDiscountEvidence.redeemAttemptClaim"
)(function* (input: {
  readonly tx: DiscountEvidenceTransaction;
  readonly orderId: OrderId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly redeemedAt: Temporal.Instant;
  readonly allowReleased?: boolean;
}) {
  yield* repairAttemptEvidenceOrder(input);

  const [discountClaims, voucherClaims] = yield* Effect.all([
    input.tx
      .select({
        dotyposCustomerId: discountCodeRedemptions.dotyposCustomerId,
        id: discountCodeRedemptions.codeId,
        state: discountCodeRedemptions.state,
      })
      .from(discountCodeRedemptions)
      .where(
        eq(discountCodeRedemptions.paymentAttemptId, input.paymentAttemptId)
      )
      .limit(1)
      .for("update"),
    input.tx
      .select({
        applicationId: voucherRedemptions.applicationId,
        id: voucherRedemptions.voucherId,
        state: voucherRedemptions.state,
      })
      .from(voucherRedemptions)
      .where(eq(voucherRedemptions.paymentAttemptId, input.paymentAttemptId))
      .limit(1)
      .for("update"),
  ]);
  const claim = selectStoredPromotionClaim(discountClaims[0], voucherClaims[0]);

  if (!claim) return;
  if (claim.state === "released" && !input.allowReleased) {
    return yield* new DiscountClaimError({
      operation: "redeem",
      reason: "claim_conflict",
      message: "A released promotion claim cannot be redeemed.",
      codeId: claim.id,
    });
  }
  if (claim.state === "redeemed") return;

  if (claim.state === "released" && claim.kind === "discount") {
    const [code] = yield* input.tx
      .select({ maxUses: discountCodes.maxUses })
      .from(discountCodes)
      .where(eq(discountCodes.id, claim.id))
      .limit(1)
      .for("update");
    if (!code) {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "unknown_code",
        message: "The accepted discount code no longer exists.",
        codeId: claim.id,
      });
    }

    const [customerUse] = yield* input.tx
      .select({ state: discountCodeRedemptions.state })
      .from(discountCodeRedemptions)
      .where(
        and(
          eq(discountCodeRedemptions.codeId, claim.id),
          eq(
            discountCodeRedemptions.dotyposCustomerId,
            claim.dotyposCustomerId
          ),
          inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
        )
      )
      .limit(1);
    if (customerUse) {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason:
          customerUse.state === "redeemed"
            ? "already_redeemed"
            : "claim_conflict",
        message: "The customer has another active claim for this code.",
        codeId: claim.id,
      });
    }

    if (code.maxUses !== null) {
      const [uses] = yield* input.tx
        .select({ count: count() })
        .from(discountCodeRedemptions)
        .where(
          and(
            eq(discountCodeRedemptions.codeId, claim.id),
            inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
          )
        );
      if ((uses?.count ?? 0) >= code.maxUses) {
        return yield* new DiscountClaimError({
          operation: "redeem",
          reason: "usage_limit_reached",
          message: "The accepted discount code has no remaining uses.",
          codeId: claim.id,
        });
      }
    }
  }

  if (claim.state === "released" && claim.kind === "voucher") {
    const [voucher] = yield* input.tx
      .select()
      .from(vouchers)
      .where(eq(vouchers.id, claim.id))
      .limit(1)
      .for("update");
    if (!voucher) {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "unknown_code",
        message: "The accepted voucher no longer exists.",
        codeId: claim.id,
      });
    }

    if (claim.applicationId === null) {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "claim_conflict",
        message: "A releasable voucher claim must reference its application.",
        codeId: claim.id,
      });
    }
    const [[application], [usage]] = yield* Effect.all([
      input.tx
        .select({
          currency: discountApplications.appliedAmountCurrency,
          exponent: discountApplications.appliedAmountExponent,
          value: discountApplications.appliedAmountValue,
        })
        .from(discountApplications)
        .where(eq(discountApplications.id, claim.applicationId))
        .limit(1),
      input.tx
        .select({
          value: sql<number>`coalesce(sum(${voucherRedemptionAppliedAmountValue}), 0)::integer`,
        })
        .from(voucherRedemptions)
        .leftJoin(
          discountApplications,
          eq(discountApplications.id, voucherRedemptions.applicationId)
        )
        .where(
          and(
            eq(voucherRedemptions.voucherId, claim.id),
            inArray(voucherRedemptions.state, ["reserved", "redeemed"])
          )
        ),
    ]);
    if (
      !application ||
      application.currency !== voucher.issuedAmountCurrency ||
      application.exponent !== voucher.issuedAmountExponent ||
      application.value > voucher.issuedAmountValue - (usage?.value ?? 0)
    ) {
      return yield* new DiscountClaimError({
        operation: "redeem",
        reason: "claim_conflict",
        message: "The voucher no longer has enough available credit.",
        codeId: claim.id,
      });
    }
  }

  const values = {
    state: "redeemed" as const,
    redeemedAt: input.redeemedAt,
    releasedAt: null,
    releaseReason: null,
    updatedAt: input.redeemedAt,
  };
  const claimableStates = input.allowReleased
    ? (["reserved", "released"] as const)
    : (["reserved"] as const);
  yield* Match.value(claim).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount: () =>
        input.tx
          .update(discountCodeRedemptions)
          .set(values)
          .where(
            and(
              eq(
                discountCodeRedemptions.paymentAttemptId,
                input.paymentAttemptId
              ),
              inArray(discountCodeRedemptions.state, claimableStates)
            )
          )
          .pipe(Effect.asVoid),
      voucher: () =>
        input.tx
          .update(voucherRedemptions)
          .set(values)
          .where(
            and(
              eq(voucherRedemptions.paymentAttemptId, input.paymentAttemptId),
              inArray(voucherRedemptions.state, claimableStates)
            )
          )
          .pipe(Effect.asVoid),
    })
  );
});

export const releaseAttemptDiscountClaim = Effect.fn(
  "OrderDiscountEvidence.releaseAttemptClaim"
)(function* (input: {
  readonly tx: DiscountEvidenceTransaction;
  readonly orderId: OrderId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly releasedAt: Temporal.Instant;
  readonly releaseReason: string;
}) {
  yield* repairAttemptEvidenceOrder(input);

  const [discountClaims, voucherClaims] = yield* Effect.all([
    input.tx
      .select({
        id: discountCodeRedemptions.codeId,
        state: discountCodeRedemptions.state,
      })
      .from(discountCodeRedemptions)
      .where(
        eq(discountCodeRedemptions.paymentAttemptId, input.paymentAttemptId)
      )
      .limit(1)
      .for("update"),
    input.tx
      .select({
        id: voucherRedemptions.voucherId,
        state: voucherRedemptions.state,
      })
      .from(voucherRedemptions)
      .where(eq(voucherRedemptions.paymentAttemptId, input.paymentAttemptId))
      .limit(1)
      .for("update"),
  ]);
  const claim = selectStoredPromotionClaim(discountClaims[0], voucherClaims[0]);

  if (!claim) return;
  if (claim.state === "redeemed") {
    return yield* new DiscountClaimError({
      operation: "release",
      reason: "claim_conflict",
      message: "A redeemed promotion claim cannot be released.",
      codeId: claim.id,
    });
  }
  if (claim.state === "released") return;

  const values = {
    state: "released" as const,
    releasedAt: input.releasedAt,
    releaseReason: input.releaseReason,
    updatedAt: input.releasedAt,
  };
  yield* Match.value(claim).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount: () =>
        input.tx
          .update(discountCodeRedemptions)
          .set(values)
          .where(
            and(
              eq(
                discountCodeRedemptions.paymentAttemptId,
                input.paymentAttemptId
              ),
              eq(discountCodeRedemptions.state, "reserved")
            )
          )
          .pipe(Effect.asVoid),
      voucher: () =>
        input.tx
          .update(voucherRedemptions)
          .set(values)
          .where(
            and(
              eq(voucherRedemptions.paymentAttemptId, input.paymentAttemptId),
              eq(voucherRedemptions.state, "reserved")
            )
          )
          .pipe(Effect.asVoid),
    })
  );
});

const claimError = (
  operation: "reserve" | "redeem" | "release",
  reason: ConstructorParameters<typeof DiscountClaimError>[0]["reason"],
  message: string,
  claim?: DiscountClaimInstruction
) =>
  new DiscountClaimError({
    operation,
    reason,
    message,
    codeId: getPromotionClaimId(claim),
  });

const validateAppliedDiscountMoney = Effect.fn(
  "OrderDiscountEvidence.validateAppliedMoney"
)(function* (application: AppliedDiscount, claim?: DiscountClaimInstruction) {
  const amountInSubtotalUnit = workspaceMoneyWithValue(
    application.amount.value,
    application.subtotalBefore
  );
  const expectedSubtotalAfter = workspaceMoneyWithValue(
    application.subtotalBefore.value - application.amount.value,
    application.subtotalBefore
  );
  if (
    application.subtotalBefore.value <= 0 ||
    application.amount.value <= 0 ||
    application.subtotalAfter.value < 0 ||
    !workspaceMoneyEquals(amountInSubtotalUnit, application.amount) ||
    !workspaceMoneyEquals(expectedSubtotalAfter, application.subtotalAfter)
  ) {
    return yield* claimError(
      "reserve",
      "money_mismatch",
      "A committed discount application has inconsistent money.",
      claim
    );
  }
});

const storedApplicationsMatchEvidence = (
  rows: readonly (typeof discountApplications.$inferSelect)[],
  applications: readonly DiscountApplicationEvidence[]
): boolean =>
  rows.length === applications.length &&
  rows.every((row) => {
    const committed = applications[row.sequence];
    if (!committed) return false;
    const { application, product, provenance } = committed;
    const adjustment = Option.getOrUndefined(
      Schema.decodeUnknownOption(discountAdjustmentSchema, {
        onExcessProperty: "error",
      })(row.adjustment)
    );
    const productIdentity = Option.getOrUndefined(
      Schema.decodeUnknownOption(workspaceProductIdentitySchema, {
        onExcessProperty: "error",
      })(row.productIdentity)
    );
    return (
      adjustment !== undefined &&
      productIdentity !== undefined &&
      row.publicDiscountId === application.discount.id &&
      row.label === application.discount.label &&
      discountAdjustmentsEqual(adjustment, application.discount.adjustment) &&
      workspaceProductIdentityEquals(productIdentity, product) &&
      row.subtotalBeforeValue === application.subtotalBefore.value &&
      row.subtotalBeforeExponent === application.subtotalBefore.exponent &&
      row.subtotalBeforeCurrency === application.subtotalBefore.currency &&
      row.appliedAmountValue === application.amount.value &&
      row.appliedAmountExponent === application.amount.exponent &&
      row.appliedAmountCurrency === application.amount.currency &&
      row.subtotalAfterValue === application.subtotalAfter.value &&
      row.subtotalAfterExponent === application.subtotalAfter.exponent &&
      row.subtotalAfterCurrency === application.subtotalAfter.currency &&
      (row.expiresAt?.toString() ?? undefined) ===
        application.discount.expiresAt &&
      (row.countdownStartsAt?.toString() ?? undefined) ===
        application.discount.countdownStartsAt &&
      isDeepStrictEqual(row.provenance, provenance)
    );
  });

const getPromotionClaimId = (claim: DiscountClaimInstruction | undefined) => {
  if (!claim) return undefined;
  return claim.kind === "discount_code" ? claim.codeId : claim.voucherId;
};

const discountAdjustmentsEqual = (
  left: DiscountAdjustment,
  right: DiscountAdjustment
): boolean => {
  if (left.kind === "percentage" && right.kind === "percentage") {
    return left.basisPoints === right.basisPoints;
  }
  if (left.kind === "fixed" && right.kind === "fixed") {
    return workspaceMoneyEquals(left.amount, right.amount);
  }
  return false;
};

const selectStoredPromotionClaim = <
  DiscountClaim extends { readonly id: string; readonly state: string },
  VoucherClaim extends { readonly id: string; readonly state: string },
>(
  discountClaim: DiscountClaim | undefined,
  voucherClaim: VoucherClaim | undefined
) => {
  if (discountClaim) return { kind: "discount", ...discountClaim } as const;
  if (voucherClaim) return { kind: "voucher", ...voucherClaim } as const;
  return undefined;
};
