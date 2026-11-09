import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";

const HOST = "workspace.test";

let handlerOverride:
  | ((request: Request) => Promise<Response> | Response)
  | null = null;

mock.module("@/features/account/server/auth.server", () => ({
  auth: {
    handler: (request: Request) => {
      if (!handlerOverride) {
        throw new Error("No auth handler installed for this test");
      }
      return handlerOverride(request);
    },
  },
}));

let wrapperIpCounter = 0;
const callRoute = async (
  path: string,
  method: "GET" | "POST",
  init: RequestInit = {}
) => {
  const { GET, POST } = (await import("./route")) as {
    GET: (request: Request) => Promise<Response>;
    POST: (request: Request) => Promise<Response>;
  };
  const handler = method === "GET" ? GET : POST;
  wrapperIpCounter += 1;
  return handler(
    new Request(`https://${HOST}/api/auth${path}`, {
      ...init,
      headers: {
        origin: `https://${HOST}`,
        "x-vercel-forwarded-for": `192.0.2.${wrapperIpCounter}`,
        ...((init.headers as Record<string, string>) ?? {}),
      },
    })
  );
};

const cannedResponse = (init: {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}) =>
  new Response(init.body ?? null, {
    status: init.status,
    headers: init.headers,
  });

describe("Better Auth route wrapper", () => {
  test("preserves redirects and Set-Cookie headers while overriding upstream caching", async () => {
    handlerOverride = () =>
      cannedResponse({
        status: 302,
        headers: {
          location: `https://${HOST}/cs-CZ/account`,
          "set-cookie": "session_token=rotated; Path=/; HttpOnly; SameSite=Lax",
          "cache-control": "public, max-age=3600",
        },
      });

    const response = await callRoute("/magic-link/verify?token=x", "GET");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `https://${HOST}/cs-CZ/account`
    );
    expect(response.headers.getSetCookie()).toEqual([
      "session_token=rotated; Path=/; HttpOnly; SameSite=Lax",
    ]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
