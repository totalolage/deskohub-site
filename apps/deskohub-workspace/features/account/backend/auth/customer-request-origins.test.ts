import { describe, expect, mock, test } from "bun:test";
import { Effect, Exit } from "effect";

const trustedOrigins = new Set(["https://workspace.deskohub.test", "deskohub://"]);
const askedOrigins: string[] = [];
let authContext: Promise<{ isTrustedOrigin: (url: string) => boolean }> =
  Promise.resolve({
    isTrustedOrigin: (url) => {
      askedOrigins.push(url);
      return trustedOrigins.has(url);
    },
  });

mock.module("@/features/account/server/auth.server", () => ({
  auth: {
    get $context() {
      return authContext;
    },
  },
}));

const { CustomerRequestOrigins, CustomerRequestOriginsUnavailableError } =
  await import("./customer-request-origins");

const isTrusted = (
  origin: string,
  layer = CustomerRequestOrigins.Default
) =>
  CustomerRequestOrigins.use((origins) => origins.isTrusted(origin)).pipe(
    Effect.provide(layer),
    Effect.runPromiseExit
  );

describe("CustomerRequestOrigins", () => {
  test("trusts the origins Better Auth trusts", async () => {
    expect(await isTrusted("https://workspace.deskohub.test")).toEqual(
      Exit.succeed(true)
    );
    expect(await isTrusted("deskohub://")).toEqual(Exit.succeed(true));
    expect(askedOrigins).toEqual(["https://workspace.deskohub.test", "deskohub://"]);
  });

  test("rejects an origin Better Auth does not trust", async () => {
    expect(await isTrusted("https://attacker.test")).toEqual(
      Exit.succeed(false)
    );
  });

  test("fails closed with a typed error when Better Auth cannot answer", async () => {
    const broken = new Error("auth bootstrap failed");
    authContext = Promise.reject(broken);
    authContext.catch(() => undefined);

    const exit = await isTrusted("https://workspace.deskohub.test");

    expect(exit).toEqual(
      Exit.fail(new CustomerRequestOriginsUnavailableError({ cause: broken }))
    );
  });

  test("asks an injected authority", async () => {
    const authority = {
      isTrustedOrigin: async (origin: string) => origin === "deskohub://",
    };
    const layer = CustomerRequestOrigins.fromAuthority(authority);

    expect(await isTrusted("deskohub://", layer)).toEqual(Exit.succeed(true));
    expect(await isTrusted("https://attacker.test", layer)).toEqual(
      Exit.succeed(false)
    );
  });

  test("fails closed when an injected authority rejects", async () => {
    const broken = new Error("authority unavailable");
    const layer = CustomerRequestOrigins.fromAuthority({
      isTrustedOrigin: () => Promise.reject(broken),
    });

    expect(await isTrusted("deskohub://", layer)).toEqual(
      Exit.fail(new CustomerRequestOriginsUnavailableError({ cause: broken }))
    );
  });
});
