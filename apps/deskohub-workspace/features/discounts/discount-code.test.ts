import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { Effect, Option, Schema } from "effect";
import type { DiscountCode } from "@/db/schema";
import {
  decodeDiscountCodeAvailability,
  decodeDiscountCodeConfiguration,
  normalizeSubmittedDiscountCode,
} from "./discount-code";
import {
  canonicalDiscountCodeSchema,
  discountCodeIdSchema,
  storedDiscountIdSchema,
} from "./persistence-contracts";

const codeId = Schema.decodeUnknownSync(discountCodeIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82eda1"
);
const discountId = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
);
const canonicalCode = Schema.decodeUnknownSync(canonicalDiscountCodeSchema)(
  "SUMMER_50"
);

const codeRow = (overrides: Partial<DiscountCode> = {}): DiscountCode => ({
  id: codeId,
  discountId,
  code: canonicalCode,
  enabled: true,
  validFrom: null,
  validUntil: null,
  maxUses: null,
  createdAt: Temporal.Instant.from("2026-07-15T00:00:00.000Z"),
  updatedAt: Temporal.Instant.from("2026-07-15T00:00:00.000Z"),
  ...overrides,
});

describe("discount code normalization", () => {
  test.each([
    [" summer_50 ", "SUMMER_50"],
    ["abc", "ABC"],
    ["a-b", "A-B"],
    ["A".repeat(64), "A".repeat(64)],
  ])("normalizes %s", async (submittedCode, expected) => {
    const result = await Effect.runPromise(
      normalizeSubmittedDiscountCode({ submittedCode })
    );

    expect(Option.getOrUndefined(result)).toBe(expected);
  });

  test("keeps an omitted code absent", async () => {
    const result = await Effect.runPromise(
      normalizeSubmittedDiscountCode({ submittedCode: undefined })
    );

    expect(Option.isNone(result)).toBe(true);
  });

  test.each([
    "",
    "  ",
  ])("keeps a blank submitted code absent", async (submittedCode) => {
    const result = await Effect.runPromise(
      normalizeSubmittedDiscountCode({ submittedCode })
    );

    expect(Option.isNone(result)).toBe(true);
  });

  test.each([
    "AB",
    "A".repeat(65),
    ".ABC",
    "A B",
    "ſUMMER",
    "ß50",
  ])("rejects invalid submitted code %s", async (submittedCode) => {
    const result = await Effect.runPromise(
      normalizeSubmittedDiscountCode({ submittedCode }).pipe(Effect.result)
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "invalid_syntax" },
    });
    expect(JSON.stringify(result)).not.toContain(submittedCode);
  });
});

describe("stored discount code configuration", () => {
  test("decodes a valid typed database row without exposing its code", async () => {
    const result = await Effect.runPromise(
      decodeDiscountCodeConfiguration({ row: codeRow() })
    );

    expect(result).toEqual({
      id: codeId,
      discountId,
      enabled: true,
      validFrom: null,
      validUntil: null,
      maxUses: null,
    });
    expect(result).not.toHaveProperty("code");
  });

  test("rejects a noncanonical stored code", async () => {
    const result = await Effect.runPromise(
      decodeDiscountCodeConfiguration({
        row: codeRow({ code: "summer_50" as typeof canonicalCode }),
      }).pipe(Effect.result)
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountCodeConfigurationError",
        codeId,
      },
    });
  });

  test.each([
    ["zero maximum uses", codeRow({ maxUses: 0 })],
    ["fractional maximum uses", codeRow({ maxUses: 1.5 })],
    [
      "inverted validity window",
      codeRow({
        validFrom: Temporal.Instant.from("2026-08-01T00:00:00.000Z"),
        validUntil: Temporal.Instant.from("2026-07-31T00:00:00.000Z"),
      }),
    ],
    [
      "invalid instant",
      codeRow({
        validUntil: "invalid" as unknown as DiscountCode["validUntil"],
      }),
    ],
  ])("rejects %s", async (_label, row) => {
    const result = await Effect.runPromise(
      decodeDiscountCodeConfiguration({ row }).pipe(Effect.result)
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountCodeConfigurationError",
        codeId,
      },
    });
  });

  test("rejects malformed availability aggregates", async () => {
    const result = await Effect.runPromise(
      decodeDiscountCodeAvailability({
        codeId,
        availability: {
          allowlistSize: -1,
          customerAllowed: false,
          activeUseCount: 0,
          customerHasRedeemed: false,
        },
      }).pipe(Effect.result)
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "DiscountCodeConfigurationError", codeId },
    });
  });
});
