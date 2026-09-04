import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertAuthSessionReady,
  assertCanonicalSignInReady,
  assertRegisteredCrons,
  emitRollbackTarget,
  resolveProductionRollbackTarget,
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
    }
  | {
      readonly deployment?: {
        readonly id: string | null;
        readonly url: string | null;
      };
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

  test("targets the deployment the canonical production alias serves, not the newest promoted deployment", async () => {
    mockGlobalFetch((input) => {
      const url = new URL(input.toString());
      if (url.pathname === "/v4/aliases/deskohub-workspace-site.vercel.app") {
        return jsonResponse({
          deployment: {
            id: "dpl_retained",
            url: "https://workspace-older.vercel.app",
          },
        });
      }
      if (url.pathname === "/v7/deployments") {
        return jsonResponse({
          deployments: [
            {
              ready: 900,
              target: "production",
              url: "https://workspace-newest-promoted.vercel.app",
              readySubstate: "PROMOTED",
            },
            {
              ready: 950,
              target: "production",
              url: "https://workspace-staged.vercel.app",
              readySubstate: "STAGED",
            },
          ],
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const target = await resolveProductionRollbackTarget("token", "team_test");

    expect(target).toEqual({
      id: "dpl_retained",
      url: "https://workspace-older.vercel.app",
    });
  });

  test("scopes the canonical alias lookup to the Vercel team", async () => {
    const requested: URL[] = [];
    mockGlobalFetch((input) => {
      requested.push(new URL(input.toString()));
      return jsonResponse({
        deployment: {
          id: "dpl_retained",
          url: "https://workspace-retained.vercel.app",
        },
      });
    });

    const target = await resolveProductionRollbackTarget("token", "team_test");

    expect(target?.url).toBe("https://workspace-retained.vercel.app");
    expect(requested).toHaveLength(1);
    expect(requested[0]?.pathname).toBe(
      "/v4/aliases/deskohub-workspace-site.vercel.app"
    );
    expect(requested[0]?.searchParams.get("teamId")).toBe("team_test");
  });

  test("fails closed when the canonical production alias serves no deployment url", async () => {
    mockGlobalFetch(() =>
      jsonResponse({ deployment: { id: "dpl_retained", url: null } })
    );

    await expect(
      resolveProductionRollbackTarget("token", undefined)
    ).rejects.toThrow("canonical production alias");
  });

  test("fails closed when the canonical production alias is missing", async () => {
    mockGlobalFetch(() => new Response("Not found", { status: 404 }));

    await expect(
      resolveProductionRollbackTarget("token", undefined)
    ).rejects.toThrow("Vercel API");
  });

  test("publishes the masked rollback target only through the GitHub output file", async () => {
    const outputFile = join(
      mkdtempSync(join(tmpdir(), "rollback-target-")),
      "github-output"
    );
    await appendFile(outputFile, "earlier_step_output=1\n");
    const previousStdout = process.stdout.write;
    const stdout: string[] = [];
    process.stdout.write = ((chunk: string) => {
      stdout.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    const previousEnv = {
      VERCEL_TOKEN: process.env.VERCEL_TOKEN,
      VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
      VERCEL_ORG_ID: process.env.VERCEL_ORG_ID,
      GITHUB_OUTPUT: process.env.GITHUB_OUTPUT,
    };
    process.env.VERCEL_TOKEN = "test-token";
    process.env.VERCEL_PROJECT_ID = "prj_test";
    delete process.env.VERCEL_ORG_ID;
    process.env.GITHUB_OUTPUT = outputFile;
    mockGlobalFetch(() =>
      jsonResponse({
        deployment: {
          id: "dpl_retained",
          url: "https://workspace-older.vercel.app",
        },
      })
    );

    try {
      await emitRollbackTarget();
    } finally {
      process.stdout.write = previousStdout;
      if (previousEnv.VERCEL_TOKEN === undefined) {
        delete process.env.VERCEL_TOKEN;
      } else {
        process.env.VERCEL_TOKEN = previousEnv.VERCEL_TOKEN;
      }
      if (previousEnv.VERCEL_PROJECT_ID === undefined) {
        delete process.env.VERCEL_PROJECT_ID;
      } else {
        process.env.VERCEL_PROJECT_ID = previousEnv.VERCEL_PROJECT_ID;
      }
      if (previousEnv.VERCEL_ORG_ID === undefined) {
        delete process.env.VERCEL_ORG_ID;
      } else {
        process.env.VERCEL_ORG_ID = previousEnv.VERCEL_ORG_ID;
      }
      if (previousEnv.GITHUB_OUTPUT === undefined) {
        delete process.env.GITHUB_OUTPUT;
      } else {
        process.env.GITHUB_OUTPUT = previousEnv.GITHUB_OUTPUT;
      }
    }

    expect(stdout.join("")).toBe(
      "::add-mask::https://workspace-older.vercel.app\n"
    );
    expect(await Bun.file(outputFile).text()).toBe(
      "earlier_step_output=1\nprevious_url=https://workspace-older.vercel.app\n"
    );
  });

  test("fails closed without publishing an output when the rollback target cannot be resolved", async () => {
    const outputFile = join(
      mkdtempSync(join(tmpdir(), "rollback-target-")),
      "github-output"
    );
    await appendFile(outputFile, "");
    const previousEnv = {
      VERCEL_TOKEN: process.env.VERCEL_TOKEN,
      VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
      VERCEL_ORG_ID: process.env.VERCEL_ORG_ID,
      GITHUB_OUTPUT: process.env.GITHUB_OUTPUT,
    };
    process.env.VERCEL_TOKEN = "test-token";
    process.env.VERCEL_PROJECT_ID = "prj_test";
    delete process.env.VERCEL_ORG_ID;
    process.env.GITHUB_OUTPUT = outputFile;
    mockGlobalFetch(() => new Response("Not found", { status: 404 }));

    try {
      await expect(emitRollbackTarget()).rejects.toThrow("Vercel API");
    } finally {
      if (previousEnv.VERCEL_TOKEN === undefined) {
        delete process.env.VERCEL_TOKEN;
      } else {
        process.env.VERCEL_TOKEN = previousEnv.VERCEL_TOKEN;
      }
      if (previousEnv.VERCEL_PROJECT_ID === undefined) {
        delete process.env.VERCEL_PROJECT_ID;
      } else {
        process.env.VERCEL_PROJECT_ID = previousEnv.VERCEL_PROJECT_ID;
      }
      if (previousEnv.VERCEL_ORG_ID === undefined) {
        delete process.env.VERCEL_ORG_ID;
      } else {
        process.env.VERCEL_ORG_ID = previousEnv.VERCEL_ORG_ID;
      }
      if (previousEnv.GITHUB_OUTPUT === undefined) {
        delete process.env.GITHUB_OUTPUT;
      } else {
        process.env.GITHUB_OUTPUT = previousEnv.GITHUB_OUTPUT;
      }
    }

    expect(await Bun.file(outputFile).text()).toBe("");
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
