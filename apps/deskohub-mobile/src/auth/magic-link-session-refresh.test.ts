import { describe, expect, test } from "bun:test";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { magicLinkSessionRefresh } from "./magic-link-session-refresh";

const origin = "https://workspace.test";

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A web client against a Workspace whose verify accepts only `fresh`. */
const makeClient = () => {
  const requests: Array<string> = [];
  const client = createAuthClient({
    baseURL: `${origin}/api/auth`,
    plugins: [magicLinkClient(), magicLinkSessionRefresh()],
    fetchOptions: {
      customFetchImpl: async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input);
        requests.push(url.pathname);
        if (url.pathname !== "/api/auth/magic-link/verify") {
          return answer(404, { code: "NOT_FOUND" });
        }
        return url.searchParams.get("token") === "fresh"
          ? answer(200, { status: true })
          : answer(400, { code: "INVALID_TOKEN" });
      },
    },
  });
  const signal = client.$store.atoms.$sessionSignal;
  if (signal === undefined) throw new Error("no session signal atom");
  let refreshes = 0;
  const stop = signal.listen(() => {
    refreshes += 1;
  });
  return { client, requests, refreshes: () => refreshes, stop };
};

/** Better Auth raises the session signal on a short timer after a call. */
const signalTimers = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("magic-link session refresh", () => {
  // The browser keeps the verify's cookie itself, so nothing else tells the
  // page's session that it is now signed in.
  test("a verified magic link refreshes the session the app reads", async () => {
    const workspace = makeClient();

    const result = await workspace.client.magicLink.verify({
      query: { token: "fresh" },
    });
    await signalTimers();
    workspace.stop();

    expect(result.error).toBeNull();
    expect(workspace.requests).toEqual(["/api/auth/magic-link/verify"]);
    expect(workspace.refreshes()).toBe(1);
  });

  test("a rejected magic link leaves the session alone", async () => {
    const workspace = makeClient();

    const result = await workspace.client.magicLink.verify({
      query: { token: "used" },
    });
    await signalTimers();
    workspace.stop();

    expect(result.error?.status).toBe(400);
    expect(workspace.refreshes()).toBe(0);
  });
});
