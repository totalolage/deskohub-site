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
  test("matches promotion variants explicitly", async () => {
    const source = await Bun.file(
      new URL("./promotion-code.ts", import.meta.url)
    ).text();

    expect(source).not.toContain('configuration.kind === "discount"');
  });

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
    });
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

  test.each([
    ["mixed child data", discountRow({ voucherId })],
    ["noncanonical code", discountRow({ code: "summer_50" })],
    ["zero maximum uses", discountRow({ maxUses: 0 })],
    ["zero per-customer maximum uses", discountRow({ maxUsesPerCustomer: 0 })],
    [
      "inverted validity window",
      discountRow({
        validFrom: Temporal.Instant.from("2026-08-01T00:00:00Z"),
        validUntil: Temporal.Instant.from("2026-07-31T00:00:00Z"),
      }),
    ],
  ])("rejects %s", async (_label, row) => {
    const result = await Effect.runPromise(
      decodePromotionConfiguration({
        row: row as PromotionConfigurationRow,
      }).pipe(Effect.result)
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PromotionCodeConfigurationError", promotionCodeId },
    });
  });
});
