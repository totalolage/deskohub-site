import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  getAdministrationAuthorizationUsername,
  isAdministrationAuthorizationValid,
} from "./basic-auth";

const credentials = "operator:a-long-preview-password";
const expectedHash = createHash("sha256").update(credentials).digest("hex");
const authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;

describe("administration Basic authentication", () => {
  test("accepts the exact credential pair", () => {
    expect(
      isAdministrationAuthorizationValid(authorization, expectedHash)
    ).toBe(true);
    expect(
      getAdministrationAuthorizationUsername(authorization, expectedHash)
    ).toBe("operator");
  });

  test("fails closed for absent configuration or authorization", () => {
    expect(isAdministrationAuthorizationValid(authorization, undefined)).toBe(
      false
    );
    expect(isAdministrationAuthorizationValid(null, expectedHash)).toBe(false);
  });

  test("rejects malformed, incomplete, and incorrect credentials", () => {
    const cases = [
      "Bearer token",
      "Basic %%%",
      `Basic ${Buffer.from("operator:").toString("base64")}`,
      `Basic ${Buffer.from(":password").toString("base64")}`,
      `Basic ${Buffer.from("operator:wrong").toString("base64")}`,
      `${authorization}%%%`,
      `${authorization}===`,
    ];

    for (const candidate of cases) {
      expect(isAdministrationAuthorizationValid(candidate, expectedHash)).toBe(
        false
      );
    }
  });
});
