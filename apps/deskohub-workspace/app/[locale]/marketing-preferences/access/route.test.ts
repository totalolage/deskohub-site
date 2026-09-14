import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { MarketingManagementCookieStore } from "@/features/legal/backend/marketing-management-cookies.server";

const setPendingMarketingManagementCookie = mock(
  async (_rawToken: string) => undefined
);
const cookieStore = {};
const cookies = mock(async () => cookieStore);

mock.module(
  "@/features/legal/backend/marketing-management-cookies.server",
  () => ({
    createMarketingManagementCookies: (
      _store: MarketingManagementCookieStore
    ) => ({
      setPendingMarketingManagementCookie,
    }),
  })
);
mock.module("next/headers", () => ({ cookies }));

const { GET, HEAD } = await import("./route");

const validToken = Buffer.alloc(32, 17).toString("base64url");

beforeEach(() => {
  cookies.mockClear();
  setPendingMarketingManagementCookie.mockClear();
});

const invoke = (method: "GET" | "HEAD", path: string, locale = "en-US") =>
  (method === "GET" ? GET : HEAD)(
    new Request(`https://workspace.test${path}`, { method }),
    { params: Promise.resolve({ locale }) }
  );

describe("marketing preferences access route", () => {
  test("stores one canonical token and redirects to the fixed legal route", async () => {
    const response = await invoke(
      "GET",
      `/en-US/marketing-preferences/access?token=${validToken}&redirect=https%3A%2F%2Fevil.example`
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://workspace.test/en-US/account/legal"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(setPendingMarketingManagementCookie).toHaveBeenCalledWith(
      validToken
    );
    expect(cookies).toHaveBeenCalledTimes(1);
  });

  test.each([
    "",
    "short",
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}!`,
    `${"A".repeat(43)}&token=${validToken}`,
  ])("stores the invalid sentinel for malformed token %j", async (token) => {
    setPendingMarketingManagementCookie.mockClear();

    const response = await invoke(
      "GET",
      `/cs-CZ/marketing-preferences/access${token.includes("&") ? `?token=${token}` : `?token=${encodeURIComponent(token)}`}`,
      "cs-CZ"
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://workspace.test/cs-CZ/account/legal"
    );
    expect(setPendingMarketingManagementCookie).toHaveBeenCalledWith("invalid");
    expect(cookies).toHaveBeenCalledTimes(1);
  });

  test("rejects a non-canonical 32-byte encoding", async () => {
    setPendingMarketingManagementCookie.mockClear();
    const nonCanonicalToken = `${validToken.slice(0, -1)}B`;

    const response = await invoke(
      "GET",
      `/en-US/marketing-preferences/access?token=${nonCanonicalToken}`
    );

    expect(response.status).toBe(303);
    expect(setPendingMarketingManagementCookie).toHaveBeenCalledWith("invalid");
  });

  test("validates the locale before writing state", async () => {
    setPendingMarketingManagementCookie.mockClear();

    const response = await invoke(
      "GET",
      `/sk-SK/marketing-preferences/access?token=${validToken}`,
      "sk-SK"
    );

    expect(response.status).toBe(404);
    expect(setPendingMarketingManagementCookie).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  });

  test("does not treat a caller redirect as the destination", async () => {
    setPendingMarketingManagementCookie.mockClear();

    const response = await invoke(
      "GET",
      `/cs-CZ/marketing-preferences/access?token=${validToken}&returnTo=https%3A%2F%2Fevil.example`,
      "cs-CZ"
    );

    expect(response.headers.get("location")).toBe(
      "https://workspace.test/cs-CZ/account/legal"
    );
  });

  test("does not consume or set state for HEAD", async () => {
    setPendingMarketingManagementCookie.mockClear();

    const response = await invoke(
      "HEAD",
      `/en-US/marketing-preferences/access?token=${validToken}`
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://workspace.test/en-US/account/legal"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(setPendingMarketingManagementCookie).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  });

  test("does not import or invoke a database or token-exchange service", async () => {
    const routeSource = await Bun.file(
      new URL("./route.ts", import.meta.url)
    ).text();

    expect(routeSource).not.toContain("WorkspaceDatabase");
    expect(routeSource).not.toContain("Reservation");
    expect(routeSource).not.toContain("auth");
    expect(routeSource).not.toContain("fetch(");
  });
});
