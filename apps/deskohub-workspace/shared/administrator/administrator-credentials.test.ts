import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { AdministrationActorUsername } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import {
  administratorCredentialRegistrySchema,
  isConfiguredAdministratorUsername,
} from "./administrator-credentials";

const decodeRegistry = Schema.decodeUnknownSync(
  administratorCredentialRegistrySchema
);

const digest = (credential: string) =>
  createHash("sha256").update(credential).digest("hex");

const primaryDigest = digest("admin:first-synthetic-password");
const secondaryDigest = digest("operator:second-synthetic-password");
const validRegistry = `admin:${primaryDigest}\noperator:${secondaryDigest}`;

describe("configured administrator credential registry", () => {
  test("decodes newline-separated entries into typed credentials", () => {
    const registry = decodeRegistry(validRegistry);

    expect(registry.map(({ username }) => `${username}`)).toEqual([
      "admin",
      "operator",
    ]);
    expect(registry.map(({ credentialDigest }) => credentialDigest)).toEqual([
      primaryDigest,
      secondaryDigest,
    ]);
  });

  test("accepts LF and CRLF line endings", () => {
    const crlfRegistry = `admin:${primaryDigest}\r\noperator:${secondaryDigest}`;

    expect(decodeRegistry(crlfRegistry)).toEqual(decodeRegistry(validRegistry));
    expect(() =>
      decodeRegistry(
        `admin:${primaryDigest}\r\noperator:${secondaryDigest}\r\n`
      )
    ).toThrow();
  });

  test("requires at least one entry", () => {
    expect(() => decodeRegistry(undefined)).toThrow();
    expect(() => decodeRegistry("")).toThrow();
    expect(() => decodeRegistry("\n")).toThrow();
    expect(() => decodeRegistry("\r\n")).toThrow();
  });

  test("rejects blank interior, leading, and trailing lines", () => {
    const blankLines = [
      `admin:${primaryDigest}\n\noperator:${secondaryDigest}`,
      `admin:${primaryDigest}\n   \noperator:${secondaryDigest}`,
      `admin:${primaryDigest}\r\n\r\noperator:${secondaryDigest}`,
      `\nadmin:${primaryDigest}`,
      `admin:${primaryDigest}\n`,
    ];

    for (const registry of blankLines) {
      expect(() => decodeRegistry(registry)).toThrow();
    }
  });

  test("rejects malformed lines", () => {
    const malformed = [
      "admin",
      `${primaryDigest}\nextra`,
      `admin:${primaryDigest}\nextra`,
      ":",
      `:${primaryDigest}`,
      `admin:${primaryDigest.slice(1)}`,
      `admin:${primaryDigest.toUpperCase()}`,
      `admin:${primaryDigest}ff`,
      `Admin:${primaryDigest}`,
      `-admin:${primaryDigest}`,
      `.admin:${primaryDigest}`,
      `admin name:${primaryDigest}`,
      `admin(${primaryDigest}`,
      ` admin:${primaryDigest}`,
      `admin :${primaryDigest}`,
      `${validRegistry},${primaryDigest}`,
    ];

    for (const registry of malformed) {
      expect(() => decodeRegistry(registry)).toThrow();
    }
  });

  test("rejects duplicate usernames", () => {
    expect(() =>
      decodeRegistry(`admin:${primaryDigest}\nadmin:${secondaryDigest}`)
    ).toThrow();
  });

  test("keeps configured values out of rejection messages", () => {
    const secretUsername = "hushhush";
    const secretDigest = digest("hushhush:quiet-synthetic-password");
    const cases = [
      `${secretUsername}:${secretDigest}\n${secretUsername}:${secondaryDigest}`,
      `${secretUsername}:${secretDigest}\nnonsense`,
      `${secretUsername.toUpperCase()}:${secretDigest}`,
    ];

    for (const registry of cases) {
      try {
        decodeRegistry(registry);
        throw new Error("Expected registry decoding to fail.");
      } catch (error) {
        const message = String(error);
        expect(message).not.toContain(secretUsername);
        expect(message).not.toContain(secretDigest);
        expect(message).not.toContain("quiet-synthetic-password");
      }
    }
  });

  test("answers exact username membership without exposing digests", () => {
    const registry = decodeRegistry(validRegistry);

    expect(
      isConfiguredAdministratorUsername(
        registry,
        AdministrationActorUsername.make("admin")
      )
    ).toBe(true);
    expect(
      isConfiguredAdministratorUsername(
        registry,
        AdministrationActorUsername.make("operator")
      )
    ).toBe(true);
    expect(
      isConfiguredAdministratorUsername(
        registry,
        AdministrationActorUsername.make("nobody")
      )
    ).toBe(false);
  });
});
