import { describe, expect, test } from "bun:test";
import { resolveNeonAuthConfiguration } from "./auth-config";

describe("Neon Auth configuration", () => {
  test("is enabled only when the branch URL and cookie secret are both present", () => {
    expect(resolveNeonAuthConfiguration({})).toBeUndefined();
    expect(
      resolveNeonAuthConfiguration({
        NEON_AUTH_BASE_URL: "https://auth.example.test/neondb/auth",
      })
    ).toBeUndefined();
    expect(
      resolveNeonAuthConfiguration({
        NEON_AUTH_COOKIE_SECRET: "s".repeat(32),
      })
    ).toBeUndefined();
    expect(
      resolveNeonAuthConfiguration({
        NEON_AUTH_BASE_URL: "https://auth.example.test/neondb/auth",
        NEON_AUTH_COOKIE_SECRET: "s".repeat(32),
      })
    ).toEqual({
      baseUrl: "https://auth.example.test/neondb/auth",
      cookieSecret: "s".repeat(32),
    });
  });

  test("auth pages read configuration at request time", async () => {
    const page = await Bun.file(
      new URL(
        "../../app/[locale]/(minimal-header)/auth/[path]/page.tsx",
        import.meta.url
      )
    ).text();

    expect(page).toContain("export const instant = false");
    expect(page).toContain("await connection()");
  });
});
