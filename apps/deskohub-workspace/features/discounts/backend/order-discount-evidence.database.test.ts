import "@/shared/polyfills/temporal";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { NexiCorrelationIdSchema } from "@deskohub/nexi";
import { eq, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { Pool } from "pg";
import { type DatabaseClient, makeDatabaseClient } from "@/db/database-client";
import {
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discountProductTargets,
  discounts,
  orderLines,
  orders,
  promotionCodes,
  voucherRedemptionAppliedAmountValue,
  voucherRedemptions,
  vouchers,
} from "@/db/schema";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { calculateGoodsBasketDiscounts } from "@/features/discounts/basket-calculator";
import { makeGoodsBasketDiscountCommitment } from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import {
  canonicalPromotionCodeSchema,
  discountCodeIdSchema,
  promotionCodeIdSchema,
  storedDiscountIdSchema,
  voucherIdSchema,
} from "@/features/discounts/persistence-contracts";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import { workspaceGoodsProductIdentitySchema } from "@/features/goods";
import { m } from "@/features/i18n";
import { orderIdSchema } from "@/features/order";
import {
  type DiscountEvidenceTransaction,
  persistIssuedGoodsDiscountEvidence,
} from "./order-discount-evidence";

const databaseTestsEnabled =
  process.env.WORKSPACE_ORDER_DATABASE_TESTS === "true";
const pool = databaseTestsEnabled
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;
let database: DatabaseClient;

const money = (value: number): WorkspaceMoney => ({
  value,
  exponent: 2,
  currency: "CZK",
});

class RollbackResult extends Data.TaggedError("RollbackResult")<{
  readonly value: unknown;
}> {}

const inspectTransaction = async <A>(
  run: (tx: DiscountEvidenceTransaction) => Effect.Effect<A, unknown>
): Promise<A> => {
  const rollback = await Effect.runPromise(
    Effect.flip(
      database.transaction((tx) =>
        run(tx).pipe(
          Effect.flatMap((value) => Effect.fail(new RollbackResult({ value })))
        )
      )
    )
  );
  if (!(rollback instanceof RollbackResult)) throw rollback;
  return rollback.value as A;
};

const fixture = async (kind: "discount_code" | "voucher") => {
  const suffix = crypto.randomUUID();
  const customerId = DotyposCustomerIdSchema.make(`customer-${suffix}`);
  const categoryId = DotyposCategoryIdSchema.make(`category-${suffix}`);
  const products = ["a", "b"].map((product) =>
    workspaceGoodsProductIdentitySchema.make({
      kind: "goods",
      categoryId,
      productId: DotyposProductIdSchema.make(`product-${product}-${suffix}`),
    })
  );
  const promotionId = promotionCodeIdSchema.make(`promotion-${suffix}`);
  const code = canonicalPromotionCodeSchema.make(
    `T${suffix.replaceAll("-", "").toUpperCase()}`
  );
  const discountId = storedDiscountIdSchema.make(suffix);
  const codeId = discountCodeIdSchema.make(`code-${suffix}`);
  const voucherId = voucherIdSchema.make(`voucher-${suffix}`);
  const discount =
    kind === "discount_code"
      ? {
          id: discountIdSchema.make(discountId),
          label: "Database basket discount",
          adjustment: { kind: "fixed" as const, amount: money(150) },
        }
      : {
          id: deriveOpaqueDiscountId({
            providerNamespace: "database-voucher",
            providerReference: voucherId,
          }),
          label: m.checkoutVoucherLabel({}, { locale: "en-US" }),
          adjustment: { kind: "fixed" as const, amount: money(150) },
        };
  const calculation = await Effect.runPromise(
    calculateGoodsBasketDiscounts({
      lines: [
        { product: products[0]!, discountableSubtotal: money(100) },
        { product: products[1]!, discountableSubtotal: money(200) },
      ],
      candidates: [
        {
          eligibleLineIndexes: [0, 1],
          candidate: {
            discount,
            provenance: {
              providerNamespace:
                kind === "discount_code"
                  ? "database-discount-code"
                  : "database-voucher",
              providerReference: kind === "discount_code" ? codeId : voucherId,
            },
            claim:
              kind === "discount_code"
                ? {
                    kind,
                    codeId,
                    storedDiscountId: discountId,
                    dotyposCustomerId: customerId,
                    product: products[0]!,
                  }
                : {
                    kind,
                    voucherId,
                    availableAmount: money(150),
                    dotyposCustomerId: customerId,
                  },
          },
        },
      ],
    })
  );
  return {
    code,
    codeId,
    commitment: makeGoodsBasketDiscountCommitment({
      quote: calculation.quote,
      applications: calculation.applications,
    }),
    customerId,
    discountId,
    kind,
    orderId: orderIdSchema.make(`order-${suffix}`),
    products,
    promotionId,
    voucherId,
  };
};

const seed = Effect.fn("OrderDiscountEvidenceDatabaseTest.seed")(function* (
  tx: DiscountEvidenceTransaction,
  input: Awaited<ReturnType<typeof fixture>>,
  target: WorkspaceProductTarget = {
    kind: "goods",
  }
) {
  const issuedAt = Temporal.Instant.from("2026-08-16T20:00:00Z");
  yield* tx.insert(orders).values({
    id: input.orderId,
    kind: "goods",
    correlationId: NexiCorrelationIdSchema.make(crypto.randomUUID()),
    dotyposCustomerId: input.customerId,
    paymentState: "not_started",
    fulfillmentState: "fulfilled",
    fulfilledAt: issuedAt,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  yield* tx.insert(orderLines).values(
    input.products.map((productIdentity, sequence) => ({
      orderId: input.orderId,
      sequence,
      productIdentity,
      description: `Synthetic product ${sequence}`,
      quantity: 1,
      unitPriceValue: sequence === 0 ? 100 : 200,
      undiscountedTotalValue: sequence === 0 ? 100 : 200,
      payableTotalValue: sequence === 0 ? 50 : 100,
      amountExponent: 2,
      currency: "CZK",
      createdAt: issuedAt,
    }))
  );
  yield* tx.insert(promotionCodes).values({
    id: input.promotionId,
    kind: input.kind === "discount_code" ? "discount" : "voucher",
    code: input.code,
    enabled: true,
  });
  if (input.kind === "discount_code") {
    yield* tx.insert(discounts).values({
      id: input.discountId,
      labels: {
        "en-US": "Database basket discount",
        "cs-CZ": "Database basket discount",
      },
      fixedAmountValue: 150,
      fixedAmountExponent: 2,
      fixedAmountCurrency: "CZK",
    });
    yield* tx.insert(discountProductTargets).values({
      discountId: input.discountId,
      productTarget: target,
    });
    yield* tx.insert(discountCodes).values({
      id: input.codeId,
      code: input.code,
      enabled: true,
      promotionCodeId: input.promotionId,
      discountId: input.discountId,
    });
  } else {
    yield* tx.insert(vouchers).values({
      id: input.voucherId,
      promotionCodeId: input.promotionId,
      issuedAmountValue: 150,
      issuedAmountExponent: 2,
      issuedAmountCurrency: "CZK",
    });
  }
  return issuedAt;
});

describe.skipIf(!databaseTestsEnabled)(
  "issued goods discount evidence database",
  () => {
    beforeAll(async () => {
      database = await Effect.runPromise(makeDatabaseClient(pool!));
    });

    afterAll(async () => {
      await pool?.end();
    });

    for (const kind of ["discount_code", "voucher"] as const) {
      test(`persists one redeemed ${kind} claim for every allocation and retries idempotently`, async () => {
        const input = await fixture(kind);
        const result = await inspectTransaction((tx) =>
          Effect.gen(function* () {
            const issuedAt = yield* seed(tx, input);
            const persist = () =>
              persistIssuedGoodsDiscountEvidence({
                tx,
                orderId: input.orderId,
                commitment: input.commitment,
                locale: "en-US",
                issuedAt,
              });
            yield* persist();
            yield* persist();
            const applications = yield* tx
              .select({ value: discountApplications.appliedAmountValue })
              .from(discountApplications)
              .where(eq(discountApplications.orderId, input.orderId));
            const claims =
              kind === "discount_code"
                ? yield* tx
                    .select({
                      applicationId: discountCodeRedemptions.applicationId,
                      appliedAmountValue:
                        discountCodeRedemptions.appliedAmountValue,
                      state: discountCodeRedemptions.state,
                    })
                    .from(discountCodeRedemptions)
                    .where(eq(discountCodeRedemptions.orderId, input.orderId))
                : yield* tx
                    .select({
                      applicationId: voucherRedemptions.applicationId,
                      appliedAmountValue: voucherRedemptions.appliedAmountValue,
                      state: voucherRedemptions.state,
                    })
                    .from(voucherRedemptions)
                    .where(eq(voucherRedemptions.orderId, input.orderId));
            const [voucherUsage] =
              kind === "voucher"
                ? yield* tx
                    .select({
                      value: sql<number>`coalesce(sum(${voucherRedemptionAppliedAmountValue}), 0)::integer`,
                    })
                    .from(voucherRedemptions)
                    .leftJoin(
                      discountApplications,
                      eq(
                        discountApplications.id,
                        voucherRedemptions.applicationId
                      )
                    )
                    .where(eq(voucherRedemptions.voucherId, input.voucherId))
                : [];
            return { applications, claims, voucherUsage };
          })
        );

        expect(result.applications.map(({ value }) => value).sort()).toEqual([
          50, 100,
        ]);
        expect(result.claims).toEqual([
          { applicationId: null, appliedAmountValue: 150, state: "redeemed" },
        ]);
        if (kind === "voucher") expect(result.voucherUsage?.value).toBe(150);
      });
    }

    for (const mismatch of ["target", "line", "money"] as const) {
      test(`rolls back ${mismatch} mismatches without leaving allocations or claims`, async () => {
        const input = await fixture("discount_code");
        const result = await Effect.runPromise(
          Effect.result(
            database.transaction((tx) =>
              Effect.gen(function* () {
                const issuedAt = yield* seed(
                  tx,
                  input,
                  mismatch === "target"
                    ? {
                        kind: "goods",
                        productId: input.products[0]!.productId,
                      }
                    : { kind: "goods" }
                );
                if (mismatch === "line") {
                  yield* tx
                    .update(orderLines)
                    .set({ productIdentity: input.products[0]! })
                    .where(
                      sql`${orderLines.orderId} = ${input.orderId} and ${orderLines.sequence} = 1`
                    );
                }
                if (mismatch === "money") {
                  yield* tx
                    .update(orderLines)
                    .set({ payableTotalValue: 101 })
                    .where(
                      sql`${orderLines.orderId} = ${input.orderId} and ${orderLines.sequence} = 1`
                    );
                }
                yield* persistIssuedGoodsDiscountEvidence({
                  tx,
                  orderId: input.orderId,
                  commitment: input.commitment,
                  locale: "en-US",
                  issuedAt,
                });
              })
            )
          )
        );

        expect(result._tag).toBe("Failure");
        const persisted = await pool!.query<{ readonly count: string }>(
          "select count(*) as count from orders where id = $1",
          [input.orderId]
        );
        expect(persisted.rows[0]?.count).toBe("0");
      });
    }
  }
);
