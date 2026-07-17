import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  type DiscountDefinitionRow,
  decodeDiscountDefinition,
} from "./discount-definition";
import { storedDiscountIdSchema } from "./persistence-contracts";

const discountId = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
);
const otherDiscountId = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb8"
);

const percentageRow = (
  overrides: Partial<DiscountDefinitionRow> = {}
): DiscountDefinitionRow => ({
  id: discountId,
  label: " Summer sale ",
  percentageBasisPoints: 5000,
  fixedAmountValue: null,
  fixedAmountExponent: null,
  fixedAmountCurrency: null,
  createdAt: new Date("2026-07-15T00:00:00.000Z"),
  updatedAt: new Date("2026-07-15T00:00:00.000Z"),
  productTargets: [
    {
      discountId,
      productKey: "cowork:basic",
      productIdentity: { kind: "cowork", tier: "basic" },
    },
  ],
  ...overrides,
});

const decode = (row: DiscountDefinitionRow) =>
  decodeDiscountDefinition({ row });

describe("stored discount definitions", () => {
  test("decodes and trims a percentage definition", async () => {
    const result = await Effect.runPromise(decode(percentageRow()));

    expect(result).toMatchObject({
      id: discountId,
      label: "Summer sale",
      adjustment: { kind: "percentage", basisPoints: 5000 },
      products: [{ kind: "cowork", tier: "basic" }],
    });
  });

  test("decodes a fixed-money definition", async () => {
    const result = await Effect.runPromise(
      decode(
        percentageRow({
          percentageBasisPoints: null,
          fixedAmountValue: 10_000,
          fixedAmountExponent: 2,
          fixedAmountCurrency: "CZK",
        })
      )
    );

    expect(result.adjustment).toEqual({
      kind: "fixed",
      amount: { value: 10_000, exponent: 2, currency: "CZK" },
    });
  });

  test.each([
    ["empty label", percentageRow({ label: " " })],
    ["invalid percentage", percentageRow({ percentageBasisPoints: 10_001 })],
    [
      "incomplete fixed amount",
      percentageRow({
        percentageBasisPoints: null,
        fixedAmountValue: 100,
        fixedAmountExponent: null,
        fixedAmountCurrency: "CZK",
      }),
    ],
    ["empty targets", percentageRow({ productTargets: [] })],
    [
      "mismatched target key",
      percentageRow({
        productTargets: [
          {
            discountId,
            productKey: "cowork:plus",
            productIdentity: { kind: "cowork", tier: "basic" },
          },
        ],
      }),
    ],
    [
      "target from another discount",
      percentageRow({
        productTargets: [
          {
            discountId: otherDiscountId,
            productKey: "cowork:basic",
            productIdentity: { kind: "cowork", tier: "basic" },
          },
        ],
      }),
    ],
    [
      "unknown product field",
      percentageRow({
        productTargets: [
          {
            discountId,
            productKey: "cowork:basic",
            productIdentity: {
              kind: "cowork",
              tier: "basic",
              provider: "private",
            },
          },
        ],
      }),
    ],
  ])("rejects %s", async (_label, row) => {
    const result = await Effect.runPromise(decode(row).pipe(Effect.result));

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountDefinitionMalformedError",
        discountId,
      },
    });
  });
});
