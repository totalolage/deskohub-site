import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  checkoutAttemptIdSchema,
  checkoutSessionIdSchema,
  paymentAttemptIdSchema,
  promoteCheckoutAttemptToSessionId,
} from "./checkout-identifiers";

describe("checkout identifier schemas", () => {
  test.each([
    checkoutSessionIdSchema,
    checkoutAttemptIdSchema,
    paymentAttemptIdSchema,
  ])("rejects empty identifiers", (schema) => {
    expect(() => Schema.decodeUnknownSync(schema)("")).toThrow();
  });

  test("requires an explicit promotion when an attempt starts a new session", () => {
    const attemptId = Schema.decodeUnknownSync(checkoutAttemptIdSchema)(
      "checkout-attempt"
    );

    expect(promoteCheckoutAttemptToSessionId(attemptId)).toBe(
      "checkout-attempt"
    );
  });
});
