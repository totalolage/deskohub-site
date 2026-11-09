import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { Effect, Option, Schema } from "effect";
import {
  canonicalPromotionCodeSchema,
  discountCodeIdSchema,
  promotionCodeIdSchema,
  storedDiscountIdSchema,
  voucherIdSchema,
} from "./persistence-contracts";
import {
  decodePromotionConfiguration,
  generatePromotionCode,
  normalizeSubmittedPromotionCode,
  type PromotionConfigurationRow,
} from "./promotion-code";

const promotionCodeId = promotionCodeIdSchema.make(
  "019bfe6e-8ef0-7def-8b16-55cfbc82eda0"
);
const codeId = discountCodeIdSchema.make(
  "019bfe6e-8ef0-7def-8b16-55cfbc82eda1"
);
const voucherId = voucherIdSchema.make("019bfe6e-8ef0-7def-8b16-55cfbc82eda2");
const discountId = storedDiscountIdSchema.make(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
);
const canonicalCode = canonicalPromotionCodeSchema.make("SUMMER_50");

const discountRow = (
  overrides: Partial<PromotionConfigurationRow> = {}
): PromotionConfigurationRow => ({
  promotionCodeId,
  kind: "discount",
  code: canonicalCode,
  enabled: true,
  validFrom: null,
  validUntil: null,
  discountCodeId: codeId,
  discountId,
  maxUses: null,
  maxUsesPerCustomer: null,
  serviceDateFrom: null,
  serviceDateUntil: null,
  voucherId: null,
  issuedAmountValue: null,
  issuedAmountExponent: null,
  issuedAmountCurrency: null,
  ...overrides,
});

describe("promotion code normalization", () => {
  test.each([
    [" summer_50 ", "SUMMER_50"],
    ["abc", "ABC"],
    ["a-b", "A-B"],
    ["A".repeat(64), "A".repeat(64)],
  ])("normalizes %s", async (submittedCode, expected) => {
    const result = await Effect.runPromise(
      normalizeSubmittedPromotionCode({ submittedCode })
    );

    expect(Option.getOrUndefined(result)).toBe(expected);
  });

  test.each([undefined, "", "  "])("keeps %s absent", async (submittedCode) => {
    const result = await Effect.runPromise(
      normalizeSubmittedPromotionCode({ submittedCode })
    );

    expect(Option.isNone(result)).toBe(true);
  });

  test.each(["AB", "A".repeat(65), ".ABC", "A B", "ſUMMER", "ß50"])(
    "rejects invalid submitted code %s",
    async (submittedCode) => {
      const result = await Effect.runPromise(
        normalizeSubmittedPromotionCode({ submittedCode }).pipe(Effect.result)
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { reason: "invalid_syntax" },
      });
      expect(JSON.stringify(result)).not.toContain(submittedCode);
    }
  );
});

test("generated promotion codes use the canonical readable alphabet", () => {
  const decodeCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema);

  for (let index = 0; index < 20; index += 1) {
    const code = generatePromotionCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}-[A-HJ-NP-Z2-9]{6}$/);
    expect(decodeCode(code)).toBe(code);
  }
});

describe("stored promotion configuration", () => {
  test("decodes a discount-code child", async () => {
    await expect(
      Effect.runPromise(decodePromotionConfiguration({ row: discountRow() }))
    ).resolves.toEqual({
      promotionCodeId,
      kind: "discount",
      id: codeId,
      discountId,
      enabled: true,
      validFrom: null,
      validUntil: null,
      maxUses: null,
      maxUsesPerCustomer: null,
      serviceDateFrom: null,
      serviceDateUntil: null,
    });
  });

  test("decodes a discount code's service dates", async () => {
    await expect(
      Effect.runPromise(
        decodePromotionConfiguration({
          row: discountRow({
            serviceDateFrom: "2026-07-15",
            serviceDateUntil: "2026-07-15",
          }),
        })
      )
    ).resolves.toMatchObject({
      kind: "discount",
      serviceDateFrom: "2026-07-15",
      serviceDateUntil: "2026-07-15",
    });
  });

  test.each([
    ["only a first date", { serviceDateFrom: "2026-07-01" }],
    ["only a last date", { serviceDateUntil: "2026-07-31" }],
    [
      "an inverted window",
      { serviceDateFrom: "2026-07-31", serviceDateUntil: "2026-07-01" },
    ],
    [
      "a non-canonical date",
      { serviceDateFrom: "2026-7-1", serviceDateUntil: "2026-07-31" },
    ],
  ] as const)("rejects stored service dates with %s", async (_, window) => {
    const result = await Effect.runPromise(
      decodePromotionConfiguration({ row: discountRow(window) }).pipe(
        Effect.result
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PromotionCodeConfigurationError" },
    });
  });

  test("rejects service dates on a voucher", async () => {
    const result = await Effect.runPromise(
      decodePromotionConfiguration({
        row: discountRow({
          kind: "voucher",
          discountCodeId: null,
          discountId: null,
          voucherId,
          issuedAmountValue: 10_000,
          issuedAmountExponent: 2,
          issuedAmountCurrency: "CZK",
          serviceDateFrom: "2026-07-01",
          serviceDateUntil: "2026-07-31",
        }),
      }).pipe(Effect.result)
    );

    expect(result).toMatchObject({ _tag: "Failure" });
  });

  test("decodes a voucher child without a discount", async () => {
    await expect(
      Effect.runPromise(
        decodePromotionConfiguration({
          row: discountRow({
            kind: "voucher",
            discountCodeId: null,
            discountId: null,
            voucherId,
            issuedAmountValue: 10_000,
            issuedAmountExponent: 2,
            issuedAmountCurrency: "CZK",
          }),
        })
      )
    ).resolves.toEqual({
      promotionCodeId,
      kind: "voucher",
      id: voucherId,
      enabled: true,
      validFrom: null,
      validUntil: null,
      amount: { value: 10_000, exponent: 2, currency: "CZK" },
    });
  });
});
