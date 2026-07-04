import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { NexiAmountFromWorkspaceMoney } from "./nexi-amount.codec";

const encode = Schema.encodeEffect(NexiAmountFromWorkspaceMoney);
const decode = Schema.decodeEffect(NexiAmountFromWorkspaceMoney);

describe("NexiAmountFromWorkspaceMoney", () => {
  test("encodes workspace money to Nexi amount shape", async () => {
    await expect(
      Effect.runPromise(encode({ value: 35_000, exponent: 2, currency: "CZK" }))
    ).resolves.toEqual({ amount: "35000", currency: "CZK" });
  });

  test("decodes Nexi amount shape back to workspace money", async () => {
    await expect(
      Effect.runPromise(decode({ amount: "35000", currency: "CZK" }))
    ).resolves.toEqual({ value: 35_000, exponent: 2, currency: "CZK" });
  });

  test("rejects invalid currency and fractional minor-unit amounts", async () => {
    await expect(
      Effect.runPromise(encode({ value: 35_000, exponent: 2, currency: "USD" }))
    ).rejects.toThrow();
    await expect(
      Effect.runPromise(encode({ value: 1, exponent: 3, currency: "CZK" }))
    ).rejects.toThrow();
  });
});
