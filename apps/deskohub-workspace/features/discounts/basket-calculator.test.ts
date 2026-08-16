import { describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Effect, Schema } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { workspaceGoodsProductIdentitySchema } from "@/features/goods";
import { calculateGoodsBasketDiscounts } from "./basket-calculator";
import {
  getGoodsBasketDiscountCommitmentPayload,
  makeGoodsBasketDiscountCommitment,
} from "./commitment";
import { type Discount, discountIdSchema } from "./contracts";
import { voucherIdSchema } from "./persistence-contracts";
import {
  type DiscountCandidate,
  type GoodsBasketDiscountCandidate,
  getEligibleGoodsBasketLineIndexes,
} from "./provider";

const categoryA = DotyposCategoryIdSchema.make("category-a");
const categoryB = DotyposCategoryIdSchema.make("category-b");
const productA = workspaceGoodsProductIdentitySchema.make({
  kind: "goods",
  categoryId: categoryA,
  productId: DotyposProductIdSchema.make("product-a"),
});
const productB = workspaceGoodsProductIdentitySchema.make({
  kind: "goods",
  categoryId: categoryA,
  productId: DotyposProductIdSchema.make("product-b"),
});
const productC = workspaceGoodsProductIdentitySchema.make({
  kind: "goods",
  categoryId: categoryB,
  productId: DotyposProductIdSchema.make("product-c"),
});
const money = (value: number): WorkspaceMoney => ({
  value,
  exponent: 2,
  currency: "CZK",
});
const discountId = Schema.decodeUnknownSync(discountIdSchema);

const candidate = (
  id: string,
  adjustment: Discount["adjustment"],
  input: Partial<DiscountCandidate> = {}
): DiscountCandidate => ({
  discount: { id: discountId(id), label: id, adjustment },
  provenance: {
    providerNamespace: "test",
    providerReference: id,
  },
  ...input,
});

const lines = [
  { product: productA, discountableSubtotal: money(100) },
  { product: productB, discountableSubtotal: money(200) },
  { product: productC, discountableSubtotal: money(300) },
] as const;

const calculate = (candidates: readonly GoodsBasketDiscountCandidate[]) =>
  Effect.runPromise(calculateGoodsBasketDiscounts({ lines, candidates }));

describe("goods basket discount calculator", () => {
  test("applies broad, category, and product percentage targets exactly", async () => {
    const cases = [
      { targets: [{ kind: "goods" as const }], expected: [10, 20, 30] },
      {
        targets: [{ kind: "goods" as const, categoryId: categoryA }],
        expected: [10, 20, 0],
      },
      {
        targets: [{ kind: "goods" as const, productId: productC.productId }],
        expected: [0, 0, 30],
      },
    ];

    for (const { expected, targets } of cases) {
      const eligibleLineIndexes = getEligibleGoodsBasketLineIndexes({
        lines,
        targets,
      });
      const result = await calculate([
        {
          candidate: candidate("ten", {
            kind: "percentage",
            basisPoints: 1000,
          }),
          eligibleLineIndexes,
        },
      ]);
      expect(
        result.quote.lines.map(({ totalDiscount }) => totalDiscount.value)
      ).toEqual(expected);
    }
  });

  test("applies percentage discounts only to eligible goods lines", async () => {
    const result = await calculate([
      {
        candidate: candidate("category-ten", {
          kind: "percentage",
          basisPoints: 1000,
        }),
        eligibleLineIndexes: [0, 1],
      },
      {
        candidate: candidate("product-half", {
          kind: "percentage",
          basisPoints: 5000,
        }),
        eligibleLineIndexes: [2],
      },
    ]);

    expect(
      result.quote.lines.map(({ totalDiscount }) => totalDiscount.value)
    ).toEqual([10, 20, 150]);
    expect(result.quote.totalDiscount.value).toBe(180);
  });

  test("applies one fixed benefit across the basket", async () => {
    const result = await calculate([
      {
        candidate: candidate("fixed", {
          kind: "fixed",
          amount: money(120),
        }),
        eligibleLineIndexes: [0, 1, 2],
      },
    ]);

    expect(result.quote.totalDiscount.value).toBe(120);
    expect(
      result.quote.lines.map(({ totalDiscount }) => totalDiscount.value)
    ).toEqual([20, 40, 60]);
  });

  test("allocates rounding residuals by stable line sequence", async () => {
    const equalLines = [
      { product: productA, discountableSubtotal: money(1) },
      { product: productB, discountableSubtotal: money(1) },
      { product: productC, discountableSubtotal: money(1) },
    ] as const;
    const result = await Effect.runPromise(
      calculateGoodsBasketDiscounts({
        lines: equalLines,
        candidates: [
          {
            candidate: candidate("half", {
              kind: "percentage",
              basisPoints: 5000,
            }),
            eligibleLineIndexes: [2, 0, 1],
          },
        ],
      })
    );

    expect(result.quote.totalDiscount.value).toBe(2);
    expect(
      result.quote.lines.map(({ totalDiscount }) => totalDiscount.value)
    ).toEqual([1, 1, 0]);
  });

  test("allocates large safe-integer money without floating-point loss", async () => {
    const result = await Effect.runPromise(
      calculateGoodsBasketDiscounts({
        lines: [
          {
            product: productA,
            discountableSubtotal: money(4_000_000_000_000_000),
          },
          {
            product: productB,
            discountableSubtotal: money(5_000_000_000_000_000),
          },
        ],
        candidates: [
          {
            candidate: candidate("large", {
              kind: "percentage",
              basisPoints: 3333,
            }),
            eligibleLineIndexes: [0, 1],
          },
        ],
      })
    );

    expect(result.quote.totalDiscount.value).toBe(2_999_700_000_000_000);
    expect(
      result.quote.lines.map(({ totalDiscount }) => totalDiscount.value)
    ).toEqual([1_333_200_000_000_000, 1_666_500_000_000_000]);
  });

  test("keeps one voucher claim with every positively allocated product", async () => {
    const voucher = candidate(
      "voucher",
      { kind: "fixed", amount: money(120) },
      {
        claim: {
          kind: "voucher",
          voucherId: voucherIdSchema.make("voucher-1"),
          availableAmount: money(120),
          dotyposCustomerId: DotyposCustomerIdSchema.make("customer-1"),
        },
      }
    );
    const calculation = await calculate([
      { candidate: voucher, eligibleLineIndexes: [0, 1, 2] },
    ]);
    const payload = getGoodsBasketDiscountCommitmentPayload(
      makeGoodsBasketDiscountCommitment({
        applications: calculation.applications,
      })
    );

    expect(payload.applications).toHaveLength(1);
    expect(payload.applications[0]?.claim?.kind).toBe("voucher");
    expect(
      payload.applications[0]?.lineApplications.map(({ product }) => product)
    ).toEqual([productA, productB, productC]);
  });
});
