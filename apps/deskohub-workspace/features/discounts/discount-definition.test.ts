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

const labels = {
  "en-US": " Summer sale ",
  "cs-CZ": " Letní sleva ",
} as const;

const untrustedLabels = <T>(value: T): DiscountDefinitionRow["labels"] =>
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
      productTarget: { kind: "cowork" },
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
      products: [{ kind: "cowork" }],
    });
  });

  test("decodes cowork tier targets alongside another family", async () => {
    const result = await Effect.runPromise(
      decode(
        percentageRow({
          productTargets: [
            {
              discountId,
              productTarget: { kind: "cowork", tier: "open-space" },
            },
            {
              discountId,
              productTarget: { kind: "cowork", tier: "reserved-desk" },
            },
            { discountId, productTarget: { kind: "meeting-room" } },
          ],
        })
      )
    );

    expect(result.products).toEqual([
      { kind: "cowork", tier: "open-space" },
      { kind: "cowork", tier: "reserved-desk" },
      { kind: "meeting-room" },
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
    [
      "broad cowork target mixed with a cowork tier target",
      percentageRow({
        productTargets: [
          { discountId, productTarget: { kind: "cowork" } },
          {
            discountId,
            productTarget: { kind: "cowork", tier: "open-space" },
          },
        ],
      }),
    ],
    [
      "historical cowork tier target",
      percentageRow({
        productTargets: [
          {
            discountId,
            productTarget: { kind: "cowork", tier: "profi" },
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
            productTarget: {
              kind: "cowork",
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
    if (result._tag !== "Failure") {
      throw new Error("Expected malformed discount definition");
    }
    expect(result.failure.cause).toMatchObject({ _tag: "SchemaError" });
  });
});
