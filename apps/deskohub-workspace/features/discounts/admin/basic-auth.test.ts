import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { isDiscountAdminAuthorizationValid } from "./basic-auth";

const credentials = "operator:a-long-preview-password";
const expectedHash = createHash("sha256").update(credentials).digest("hex");
const authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;

describe("discount administration Basic authentication", () => {
  test("accepts the exact credential pair", () => {
    expect(isDiscountAdminAuthorizationValid(authorization, expectedHash)).toBe(
      true
    );
  });

  test("fails closed for absent configuration or authorization", () => {
    expect(isDiscountAdminAuthorizationValid(authorization, undefined)).toBe(
      false
    );
    expect(isDiscountAdminAuthorizationValid(null, expectedHash)).toBe(false);
  });

  test("rejects malformed, incomplete, and incorrect credentials", () => {
    const cases = [
      "Bearer token",
      "Basic %%%",
      `Basic ${Buffer.from("operator:").toString("base64")}`,
      `Basic ${Buffer.from(":password").toString("base64")}`,
      `Basic ${Buffer.from("operator:wrong").toString("base64")}`,
    ];

    for (const candidate of cases) {
      expect(isDiscountAdminAuthorizationValid(candidate, expectedHash)).toBe(
        false
      );
    }
  });
});
