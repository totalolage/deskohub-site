import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { MarketingManagementCookies } from "@/features/legal/backend/marketing-management-cookies.service";
import { makeMemoryMarketingCookies } from "@/features/legal/backend/marketing-management-cookies.service.mock";

const memory = makeMemoryMarketingCookies();
const originalDefault = MarketingManagementCookies.Default;
MarketingManagementCookies.Default = memory.layer;
afterAll(() => {
  MarketingManagementCookies.Default = originalDefault;
});
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect: () => (effect: Effect.Effect<unknown>) =>
    Effect.runPromise(effect),
}));

const { GET, HEAD } = await import("./route");

const validToken = Buffer.alloc(32, 17).toString("base64url");

beforeEach(() => {
  memory.state.pending = undefined;
  memory.state.session = undefined;
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
    expect(memory.state.pending).toBe(validToken);
  });

  test.each([
    "",
    "short",
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}!`,
    `${"A".repeat(43)}&token=${validToken}`,
  ])("stores the invalid sentinel for malformed token", async (token) => {
    const response = await invoke(
      "GET",
      `/cs-CZ/marketing-preferences/access${token.includes("&") ? `?token=${token}` : `?token=${encodeURIComponent(token)}`}`,
      "cs-CZ"
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://workspace.test/cs-CZ/account/legal"
    );
    expect(memory.state.pending).toBe("invalid");
  });

  test("rejects a non-canonical 32-byte encoding", async () => {
    const nonCanonicalToken = `${validToken.slice(0, -1)}B`;

    const response = await invoke(
      "GET",
      `/en-US/marketing-preferences/access?token=${nonCanonicalToken}`
    );

    expect(response.status).toBe(303);
    expect(memory.state.pending).toBe("invalid");
  });

  test("validates the locale before writing state", async () => {
    const response = await invoke(
      "GET",
      `/sk-SK/marketing-preferences/access?token=${validToken}`,
      "sk-SK"
    );

    expect(response.status).toBe(404);
    expect(memory.state.pending).toBeUndefined();
    expect(memory.state.session).toBeUndefined();
  });

  test("does not consume or set state for HEAD", async () => {
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
    expect(memory.state.pending).toBeUndefined();
    expect(memory.state.session).toBeUndefined();
  });
});
