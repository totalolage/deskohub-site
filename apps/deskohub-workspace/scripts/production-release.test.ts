import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  assertAuthSessionReady,
  assertCanonicalSignInReady,
  assertRegisteredCrons,
  resolvePreviousProductionDeployment,
} from "./production-release";

type VercelApiPayload =
  | {
      readonly deployments?: readonly {
        readonly ready: number | null;
        readonly target: string | null;
        readonly url: string | null;
        readonly readySubstate?: string;
      }[];
    }
  | {
      readonly crons?: readonly { readonly path?: string }[];
    };

const jsonResponse = (payload: VercelApiPayload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const nullSessionResponse = () =>
  new Response("null", {
    status: 200,
    headers: { "cache-control": "private, no-store" },
  });

const restoreFetch = {
  original: undefined as typeof globalThis.fetch | undefined,
};
const mockGlobalFetch = (implementation: typeof globalThis.fetch) => {
  restoreFetch.original ??= globalThis.fetch;
  globalThis.fetch = mock(implementation);
};

afterEach(() => {
  if (restoreFetch.original) {
    globalThis.fetch = restoreFetch.original;
    restoreFetch.original = undefined;
  }
});

describe("workspace production release checks", () => {
  test("accepts a healthy anonymous null session", async () => {
    const requests: URL[] = [];
    await assertAuthSessionReady("https://staged.vercel.app", async (input) => {
      requests.push(new URL(input.toString()));
      return nullSessionResponse();
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.toString()).toBe(
      "https://staged.vercel.app/api/auth/get-session"
    );
  });

  test("rejects a session response without private/no-store", async () => {
    await expect(
      assertAuthSessionReady(
        "https://staged.vercel.app",
        async () =>
          new Response("null", {
            status: 200,
            headers: { "cache-control": "no-store" },
          })
      )
    ).rejects.toThrow("private, no-store");
  });

  test("rejects an authenticated-looking session response", async () => {
    await expect(
      assertAuthSessionReady(
        "https://staged.vercel.app",
        async () =>
          new Response('{"user":{"id":"x"}}', {
            status: 200,
            headers: { "cache-control": "private, no-store" },
          })
      )
    ).rejects.toThrow("null session");
  });

  test("rejects a failing session endpoint", async () => {
    await expect(
      assertAuthSessionReady(
        "https://staged.vercel.app",
        async () => new Response(null, { status: 503 })
      )
    ).rejects.toThrow("failed with 503");
  });

  test("probes the canonical production sign-in page and session endpoint", async () => {
    const paths: string[] = [];
    await assertCanonicalSignInReady(async (input) => {
      const url = new URL(input.toString());
      paths.push(url.pathname);
      if (url.pathname === "/api/auth/get-session") {
        return nullSessionResponse();
      }
      return new Response('<form id="account-sign-in-form"></form>', {
        status: 200,
      });
    });

    expect(paths).toEqual(["/api/auth/get-session", "/en-US/auth/sign-in"]);
  });

  test("never sends a production magic link as a release probe", async () => {
    const methods: string[] = [];
    await assertCanonicalSignInReady(async (input, init) => {
      const url = new URL(input.toString());
      methods.push(`${(init?.method ?? "GET").toUpperCase()} ${url.pathname}`);
      if (url.pathname === "/api/auth/get-session")
        return nullSessionResponse();
      return new Response('<form id="account-sign-in-form"></form>', {
        status: 200,
      });
    });

    expect(methods.every((method) => method.startsWith("GET"))).toBe(true);
    expect(methods.every((method) => !method.includes("magic-link"))).toBe(
      true
    );
  });

  test("rejects a canonical sign-in page without the magic-link form", async () => {
    await expect(
      assertCanonicalSignInReady(async (input) => {
        const url = new URL(input.toString());
        if (url.pathname === "/api/auth/get-session") {
          return nullSessionResponse();
        }
        return new Response("<main>unexpected</main>", { status: 200 });
      })
    ).rejects.toThrow("magic-link form");
  });

  test("captures the promoted deployment and skips a newer staged deployment", async () => {
    mockGlobalFetch(() =>
      jsonResponse({
        deployments: [
          {
            ready: 500,
            target: "production",
            url: "https://workspace-staged.vercel.app",
            readySubstate: "STAGED",
          },
          {
            ready: 300,
            target: "production",
            url: "https://workspace-promoted.vercel.app",
            readySubstate: "PROMOTED",
          },
          {
            ready: 100,
            target: "production",
            url: "https://workspace-older.vercel.app",
            readySubstate: "PROMOTED",
          },
        ],
      })
    );

    const previous = await resolvePreviousProductionDeployment(
      "prj_test",
      "token",
      undefined
    );
    expect(previous).toBe("https://workspace-promoted.vercel.app");
  });

  test("excludes production deployments without a promoted substate", async () => {
    mockGlobalFetch(() =>
      jsonResponse({
        deployments: [
          {
            ready: 500,
            target: "production",
            url: "https://workspace-unknown.vercel.app",
          },
          {
            ready: 300,
            target: "production",
            url: "https://workspace-rolling.vercel.app",
            readySubstate: "ROLLING",
          },
        ],
      })
    );

    const previous = await resolvePreviousProductionDeployment(
      "prj_test",
      "token",
      undefined
    );
    expect(previous).toBeUndefined();
  });

  test("rolls back with the Vercel rollback operation instead of promoting", async () => {
    const source = await Bun.file(
      new URL("./production-release.ts", import.meta.url).pathname
    ).text();

    expect(source).toMatch(/rollback \${url}/);
    expect(source).not.toContain("vercel@54.9.1 promote");
    expect(source).toContain("::add-mask::");
  });

  test("fails closed when the registered crons are missing the account cleanup", async () => {
    mockGlobalFetch(() =>
      jsonResponse({
        crons: [{ path: "/api/cron/workspace/reservation-holds" }],
      })
    );

    await expect(
      assertRegisteredCrons("prj_test", "token", undefined)
    ).rejects.toThrow("auth-cleanup");
  });

  test("accepts the registered account cleanup cron alongside the reservation sweep", async () => {
    mockGlobalFetch(() =>
      jsonResponse({
        crons: [
          { path: "/api/cron/workspace/reservation-holds" },
          { path: "/api/cron/workspace/auth-cleanup" },
        ],
      })
    );

    await expect(
      assertRegisteredCrons("prj_test", "token", "team_test")
    ).resolves.toBeUndefined();
  });
});
