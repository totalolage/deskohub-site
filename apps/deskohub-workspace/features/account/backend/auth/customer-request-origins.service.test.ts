import { describe, expect, mock, test } from "bun:test";
import { betterAuth } from "better-auth";
import { Effect, Result } from "effect";

/** Better Auth configured as the Workspace's is: dynamic allowed hosts. */
const workspaceAuth = betterAuth({
  baseURL: { allowedHosts: ["workspace.deskohub.test"], protocol: "https" },
  trustedOrigins: ["deskohub://"],
  secret: "customer-request-origins-test-secret-0123456789",
  logger: { disabled: true },
});
let authContext: Promise<{ isTrustedOrigin: (url: string) => boolean }> =
  workspaceAuth.$context;

mock.module("@/features/account/server/auth.server", () => ({
  auth: {
    get $context() {
      return authContext;
    },
  },
}));

const { CustomerRequestOrigins, CustomerRequestOriginsUnavailableError } =
  await import("./customer-request-origins.service");

const isTrusted = (origin: string, layer = CustomerRequestOrigins.Default) =>
  Effect.flatMap(CustomerRequestOrigins, (origins) =>
    origins.isTrusted(origin)
  ).pipe(Effect.provide(layer), Effect.result, Effect.runPromise);

describe("CustomerRequestOrigins", () => {
  test("trusts the allowed hosts and trusted origins Better Auth trusts", async () => {
    expect(await isTrusted("https://workspace.deskohub.test")).toEqual(
      Result.succeed(true)
    );
    expect(await isTrusted("deskohub://")).toEqual(Result.succeed(true));
  });

  test("rejects an origin Better Auth does not trust", async () => {
    for (const origin of [
      "https://attacker.test",
      "http://workspace.deskohub.test",
      "null",
    ]) {
      expect(await isTrusted(origin)).toEqual(Result.succeed(false));
    }
  });

  test("fails closed with a typed error when Better Auth cannot answer", async () => {
    authContext = Promise.reject(new Error("auth bootstrap failed"));
    authContext.catch(() => undefined);

    try {
      expect(await isTrusted("https://workspace.deskohub.test")).toEqual(
        Result.fail(new CustomerRequestOriginsUnavailableError())
      );
    } finally {
      authContext = workspaceAuth.$context;
    }
  });

  test("asks an injected authority", async () => {
    const layer = CustomerRequestOrigins.fromAuthority({
      isTrustedOrigin: async (origin) => origin === "deskohub://",
    });

    expect(await isTrusted("deskohub://", layer)).toEqual(Result.succeed(true));
    expect(await isTrusted("https://attacker.test", layer)).toEqual(
      Result.succeed(false)
    );
  });

  test("fails closed when an injected authority rejects", async () => {
    const layer = CustomerRequestOrigins.fromAuthority({
      isTrustedOrigin: () => Promise.reject(new Error("unavailable")),
    });

    expect(await isTrusted("deskohub://", layer)).toEqual(
      Result.fail(new CustomerRequestOriginsUnavailableError())
    );
  });
});
