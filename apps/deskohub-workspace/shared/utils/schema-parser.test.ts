import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";

import { makeSchemaParser } from "./schema-parser";

describe("makeSchemaParser", () => {
  const parser = makeSchemaParser(
    Schema.Struct({
      id: Schema.String,
      amount: Schema.Number,
    })
  );

  test("returns Result.success for valid payloads", () => {
    const result = parser.safeParse({ id: "desk", amount: 12.34 });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ id: "desk", amount: 12.34 });
    }
  });

  test("returns Result.failure for schema violations", () => {
    const result = parser.safeParse({ id: "desk", amount: "12.34" });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain('at ["amount"]');
    }
  });

  test("preserves throwing parse behavior", () => {
    expect(() => parser.parse({ id: "desk", amount: "12.34" })).toThrow();
    expect(
      Result.isFailure(parser.safeParse({ id: "desk", amount: "12.34" }))
    ).toBe(true);
  });
});
