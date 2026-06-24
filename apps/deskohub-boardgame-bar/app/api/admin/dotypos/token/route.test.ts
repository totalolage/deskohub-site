import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

const makeRequest = (
  body: unknown,
  url = "https://bar.example.test/api/admin/dotypos/token"
) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", host: "bar.example.test" },
    body: JSON.stringify(body),
  });

describe("Dotypos token route", () => {
  beforeEach(() => {
    setBoardgameTestEnv();
    fetchMock = mock(async () => new Response("unexpected"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("invalid body returns 400", async () => {
    const { POST } = await import("./route");

    const response = await POST(makeRequest({ locale: "en-US" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid request body - authorization code is required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("upstream non-OK status is preserved", async () => {
    const { POST } = await import("./route");
    fetchMock = mock(
      async () =>
        new Response("upstream failed", { status: 418, statusText: "Teapot" })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await POST(makeRequest({ code: "code", locale: "en-US" }));

    expect(response.status).toBe(418);
    expect(await response.json()).toEqual({
      error: "Token exchange failed",
      details: "upstream failed",
    });
  });

  test("success maps token fields", async () => {
    const { POST } = await import("./route");
    fetchMock = mock(async () =>
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "Bearer",
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await POST(makeRequest({ code: "code", locale: "en-US" }));

    const fetchCall = fetchMock.mock.calls[0];

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      tokenType: "Bearer",
    });
    expect(fetchCall?.[0]).toBe("https://api.dotykacka.cz/v2/oauth/token");
  });
});
