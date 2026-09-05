import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Schema } from "effect";
import {
  getConfiguredAdministratorAuthorizationUsername,
  isAdministratorAuthorizationValid,
} from "./administrator-basic-auth";
import { administratorCredentialRegistrySchema } from "./administrator-credentials";

const digest = (credential: string) =>
  createHash("sha256").update(credential).digest("hex");

const registry = Schema.decodeUnknownSync(
  administratorCredentialRegistrySchema
)(
  `admin:${digest("admin:first-synthetic-password")}\noperator:${digest("operator:second-synthetic-password")}`
);

const toAuthorization = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

describe("configured administrator Basic authentication", () => {
  test("authenticates every configured administrator independently", () => {
    expect(
      getConfiguredAdministratorAuthorizationUsername(
        toAuthorization("admin", "first-synthetic-password"),
        registry
      )
    ).toBe("admin");
    expect(
      getConfiguredAdministratorAuthorizationUsername(
        toAuthorization("operator", "second-synthetic-password"),
        registry
      )
    ).toBe("operator");
  });

  test("fails closed without an authorization header", () => {
    expect(
      getConfiguredAdministratorAuthorizationUsername(null, registry)
    ).toBe(null);
    expect(getConfiguredAdministratorAuthorizationUsername("", registry)).toBe(
      null
    );
  });

  test("rejects wrong, crossed, and unknown credentials", () => {
    const cases = [
      toAuthorization("admin", "second-synthetic-password"),
      toAuthorization("operator", "first-synthetic-password"),
      toAuthorization("admin", "first-synthetic-password-extra"),
      toAuthorization("unknown", "first-synthetic-password"),
      toAuthorization("nobody", "second-synthetic-password"),
    ];

    for (const authorization of cases) {
      expect(
        getConfiguredAdministratorAuthorizationUsername(authorization, registry)
      ).toBe(null);
      expect(isAdministratorAuthorizationValid(authorization, registry)).toBe(
        false
      );
    }
  });

  test("rejects malformed, incomplete, and padded credentials", () => {
    const valid = toAuthorization("admin", "first-synthetic-password");
    const cases = [
      "Bearer token",
      "Basic %%%",
      `Basic ${Buffer.from("admin:").toString("base64")}`,
      `Basic ${Buffer.from(":first-synthetic-password").toString("base64")}`,
      "Basic c29tZXRoaW5n",
      `${valid}%%%`,
      `${valid}===`,
    ];

    for (const authorization of cases) {
      expect(
        getConfiguredAdministratorAuthorizationUsername(authorization, registry)
      ).toBe(null);
    }
  });
});
