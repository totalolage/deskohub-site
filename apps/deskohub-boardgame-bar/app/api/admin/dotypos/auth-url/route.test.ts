import { beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

const makeRequest = () =>
  new NextRequest(
    "https://bar.example.test/api/admin/dotypos/auth-url?locale=cs-CZ",
    { headers: { host: "bar.example.test" } }
  );

describe("Dotypos auth URL route", () => {
  beforeEach(() => {
    setBoardgameTestEnv();
  });

  test("returns OAuth URL and redirect URI", async () => {
    const { GET } = await import("./route");

    const response = await GET(makeRequest());
    const body = (await response.json()) as {
      authUrl: string;
      redirectUri: string;
    };
    const authUrl = new URL(body.authUrl);

    expect(response.status).toBe(200);
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe(
      "https://admin.dotypos.com/client/connect"
    );
    expect(authUrl.searchParams.get("client_id")).toBe("client-id");
    expect(authUrl.searchParams.get("client_secret")).toBe("client-secret");
    expect(authUrl.searchParams.get("scope")).toBe("*");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "https://bar.example.test/cs-CZ/admin/dotypos/callback"
    );
    expect(authUrl.searchParams.get("state")).toBeTruthy();
    expect(body.redirectUri).toBe(
      "https://bar.example.test/cs-CZ/admin/dotypos/callback"
    );
  });
});
