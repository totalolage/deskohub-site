import "@/shared/polyfills/temporal";
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

const labels = {
  "en-US": " Summer sale ",
  "cs-CZ": " Letní sleva ",
} as const;

const untrustedLabels = (value: unknown): DiscountDefinitionRow["labels"] =>
  value as DiscountDefinitionRow["labels"];

const percentageRow = (
  overrides: Partial<DiscountDefinitionRow> = {}
): DiscountDefinitionRow => ({
  id: discountId,
  labels,
  percentageBasisPoints: 5000,
  fixedAmountValue: null,
  fixedAmountExponent: null,
  fixedAmountCurrency: null,
  createdAt: Temporal.Instant.from("2026-07-15T00:00:00.000Z"),
  updatedAt: Temporal.Instant.from("2026-07-15T00:00:00.000Z"),
  productTargets: [
    {
      discountId,
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
      labels: {
        "en-US": "Summer sale",
        "cs-CZ": "Letní sleva",
      },
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

  test("decodes a meeting-room product target", async () => {
    const result = await Effect.runPromise(
      decode(
        percentageRow({
          productTargets: [
            {
              discountId,
              productIdentity: {
                kind: "meeting-room",
                durationMinutes: 240,
              },
            },
          ],
        })
      )
    );

    expect(result.products).toEqual([
      { kind: "meeting-room", durationMinutes: 240 },
    ]);
  });

  test.each([
    [
      "missing locale label",
      percentageRow({
        labels: untrustedLabels({ "en-US": "Summer sale" }),
      }),
    ],
    [
      "blank locale label",
      percentageRow({
        labels: untrustedLabels({
          "en-US": "Summer sale",
          "cs-CZ": " ",
        }),
      }),
    ],
    [
      "unknown locale label",
      percentageRow({
        labels: untrustedLabels({
          "en-US": "Summer sale",
          "cs-CZ": "Letní sleva",
          "en-UK": "Misspelled locale",
        }),
      }),
    ],
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
      "target from another discount",
      percentageRow({
        productTargets: [
          {
            discountId: otherDiscountId,
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
            productIdentity: {
              kind: "cowork",
              tier: "basic",
              provider: "private",
            },
          },
        ],
      }),
    ],
    [
      "duplicate product identities",
      percentageRow({
        productTargets: [
          {
            discountId,
            productIdentity: { kind: "cowork", tier: "basic" },
          },
          {
            discountId,
            productIdentity: { kind: "cowork", tier: "basic" },
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
    if (result._tag !== "Failure") {
      throw new Error("Expected malformed discount definition");
    }
    expect(result.failure.cause).toMatchObject({ _tag: "SchemaError" });
  });
});
