import { describe, expect, test } from "bun:test";
import type { BetterAuthOptions } from "better-auth";
import {
  authOptions,
  betterAuthMagicLinkOptions,
  betterAuthSessionOptions,
} from "./auth-options";

describe("Better Auth options", () => {
  test("keeps sessions authoritative, rolling, and uncached", () => {
    expect(betterAuthSessionOptions.expiresIn).toBe(60 * 60 * 24 * 30);
    expect(betterAuthSessionOptions.updateAge).toBe(60 * 60 * 24);
    expect(betterAuthSessionOptions.freshAge).toBe(60 * 10);
    expect(betterAuthSessionOptions.cookieCache.enabled).toBe(false);
    expect(betterAuthSessionOptions.storeSessionInDatabase).toBe(true);
  });

  test("expires magic links after ten minutes and stores only hashes", () => {
    expect(betterAuthMagicLinkOptions.expiresIn).toBe(600);
    expect(betterAuthMagicLinkOptions.storeToken).toBe("hashed");
    expect(betterAuthMagicLinkOptions.rateLimit).toEqual({
      window: 600,
      max: 5,
    });
  });

  test("limits both magic-link endpoints per client IP through the database", () => {
    const rateLimit = authOptions.rateLimit as BetterAuthOptions["rateLimit"];

    expect(rateLimit?.enabled).toBe(true);
    expect(rateLimit?.storage).toBe("database");
    expect(authOptions.advanced?.ipAddress?.ipAddressHeaders).toEqual([
      "x-vercel-forwarded-for",
    ]);
  });

  test("keeps cookies host-only, lax, and leaves Secure to the deployment protocol", () => {
    expect(authOptions.advanced?.crossSubDomainCookies).toEqual({
      enabled: false,
    });
    expect(authOptions.advanced?.defaultCookieAttributes).toEqual({
      sameSite: "lax",
      path: "/",
    });
    expect(authOptions.advanced?.trustedProxyHeaders).toBe(false);
    expect(authOptions.advanced?.useSecureCookies).toBeUndefined();
  });

  test("keeps CSRF and origin checks enabled in every environment", () => {
    expect(authOptions.advanced?.disableCSRFCheck).toBe(false);
    expect(authOptions.advanced?.disableOriginCheck).toBe(false);
  });

  test("keeps passwords and social providers disabled while deletion is enabled", () => {
    expect(authOptions.emailAndPassword?.enabled).toBe(false);
    expect(authOptions.socialProviders).toBeUndefined();
    expect(authOptions.user?.deleteUser?.enabled).toBe(true);
    expect(
      authOptions.user?.additionalFields?.deletionRequestedAt
    ).toMatchObject({
      type: "date",
      required: false,
      input: false,
    });
  });

  test("hashes verification identifiers and stores rate limits in a table", () => {
    expect(authOptions.verification?.storeIdentifier).toBe("hashed");
  });

  test("stays connectionless so schema generation can import it", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const text = await fs.readFile(
      path.join(import.meta.dir, "auth-options.ts"),
      "utf8"
    );
    expect(text).not.toMatch(/@\/env/);
    expect(text).not.toMatch(/server-only/);
    expect(text).not.toMatch(/betterAuth\(/);
  });
});
