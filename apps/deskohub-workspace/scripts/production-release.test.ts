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
  promoteStagedDeployment,
  resolveCanonicalAlias,
  resolveProductionRollbackTarget,
  verifyCanonicalAliasServes,
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
    }
  | {
      readonly aliases?: readonly {
        readonly alias: string;
        readonly deploymentId?: string | null;
        readonly deployment?: {
          readonly id?: string | null;
          readonly url?: string | null;
        };
      }[];
      readonly pagination?: {
        readonly count: number;
        readonly next: number | null;
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

  test("probes the customer-facing production host for the session endpoint and sign-in page", async () => {
    const requests: URL[] = [];
    await assertCanonicalSignInReady(async (input) => {
      const url = new URL(input.toString());
      requests.push(url);
      if (url.pathname === "/api/auth/get-session") {
        return nullSessionResponse();
      }
      return new Response('<form id="account-sign-in-form"></form>', {
        status: 200,
      });
    });

    expect(requests.map((request) => request.host)).toEqual([
      "workspace.deskohub.cz",
      "workspace.deskohub.cz",
    ]);
    expect(requests.map((request) => request.pathname)).toEqual([
      "/api/auth/get-session",
      "/en-US/auth/sign-in",
    ]);
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

  test("rejects a sign-in page without the magic-link form on the customer-facing host", async () => {
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
          projectId: "prj_test",
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

    const target = await resolveProductionRollbackTarget(
      "token",
      "prj_test",
      "team_test"
    );

    expect(target).toEqual({
      id: "dpl_retained",
      url: "https://workspace-older.vercel.app",
    });
  });

  test("scopes the canonical alias lookup to the configured Vercel project and team", async () => {
    const requested: URL[] = [];
    mockGlobalFetch((input) => {
      requested.push(new URL(input.toString()));
      return jsonResponse({
        projectId: "prj_test",
        deployment: {
          id: "dpl_retained",
          url: "https://workspace-retained.vercel.app",
        },
      });
    });

    const alias = await resolveCanonicalAlias("token", "prj_test", "team_test");

    expect(alias.projectId).toBe("prj_test");
    expect(requested).toHaveLength(1);
    expect(requested[0]?.pathname).toBe(
      "/v4/aliases/deskohub-workspace-site.vercel.app"
    );
    expect(requested[0]?.searchParams.get("teamId")).toBe("team_test");
    expect(requested[0]?.searchParams.get("projectId")).toBe("prj_test");
  });

  test("fails closed when the canonical alias belongs to a different Vercel project", async () => {
    mockGlobalFetch(() =>
      jsonResponse({
        projectId: "prj_other",
        deployment: {
          id: "dpl_other",
          url: "https://workspace-other-project.vercel.app",
        },
      })
    );

    await expect(
      resolveCanonicalAlias("token", "prj_test", "team_test")
    ).rejects.toThrow("different Vercel project");
  });

  test("fails closed when the alias response omits its owning project", async () => {
    mockGlobalFetch(() =>
      jsonResponse({
        deployment: {
          id: "dpl_unknown",
          url: "https://workspace-unknown.vercel.app",
        },
      })
    );

    await expect(
      resolveCanonicalAlias("token", "prj_test", undefined)
    ).rejects.toThrow("different Vercel project");
  });

  test("fails closed when the canonical production alias serves no deployment url", async () => {
    mockGlobalFetch(() =>
      jsonResponse({
        projectId: "prj_test",
        deployment: { id: "dpl_retained", url: null },
      })
    );

    await expect(
      resolveProductionRollbackTarget("token", "prj_test", undefined)
    ).rejects.toThrow("canonical production alias");
  });

  test("fails closed when the canonical production alias is missing", async () => {
    mockGlobalFetch(() => new Response("Not found", { status: 404 }));

    await expect(
      resolveProductionRollbackTarget("token", "prj_test", undefined)
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
        projectId: "prj_test",
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

  type DeploymentState = "baseline" | "staged";

  const promotionEnvironment = () => {
    const requests: { readonly method: string; readonly url: URL }[] = [];
    let postStatus = 202;
    let clock = 0;
    let baselineDeployment: { readonly id: string; readonly url: string } = {
      id: "dpl_baseline",
      url: "https://workspace-baseline.vercel.app",
    };
    let aliasServes: (now: number) => DeploymentState = () => "baseline";
    let customDomainServes: (
      now: number
    ) => DeploymentState | "missing" | "follow" = () => "follow";
    let splitAliasPages = false;
    const persisted: string[] = [];
    const stagedDeployment = {
      id: "dpl_staged",
      url: "workspace-staged.vercel.app",
    } as const;
    const customDomainStateAt = (now: number): DeploymentState | "missing" => {
      const state = customDomainServes(now);
      return state === "follow" ? aliasServes(now) : state;
    };
    const deploymentFor = (state: DeploymentState) =>
      state === "baseline" ? baselineDeployment : stagedDeployment;
    const aliasRow = (alias: string, state: DeploymentState | "missing") => {
      if (state === "missing") return undefined;
      const deployment = deploymentFor(state);
      return { alias, deploymentId: deployment.id, deployment };
    };
    const mockFetch: typeof globalThis.fetch = (input, init) => {
      const url = new URL(input.toString());
      requests.push({
        method: (init?.method ?? "GET").toUpperCase(),
        url,
      });
      if (url.pathname.startsWith("/v10/projects/prj_test/promote/")) {
        return Promise.resolve(new Response(null, { status: postStatus }));
      }
      if (url.pathname === "/v13/deployments/workspace-staged.vercel.app") {
        return Promise.resolve(
          jsonResponse({
            id: "dpl_staged",
            readyState: "READY",
            url: "workspace-staged.vercel.app",
          })
        );
      }
      if (url.pathname === "/v4/aliases/deskohub-workspace-site.vercel.app") {
        return Promise.resolve(
          jsonResponse({
            projectId: "prj_test",
            deployment: deploymentFor(aliasServes(clock)),
          })
        );
      }
      if (url.pathname === "/v4/aliases") {
        if (splitAliasPages) {
          const until = url.searchParams.get("until");
          if (until === null) {
            return Promise.resolve(
              jsonResponse({
                aliases: [
                  aliasRow("workspace.deskohub.cz", customDomainStateAt(clock)),
                ].filter((row) => row !== undefined),
                pagination: { count: 1, next: 123 },
              })
            );
          }
          return Promise.resolve(
            jsonResponse({
              aliases: [
                aliasRow(
                  "deskohub-workspace-site.vercel.app",
                  aliasServes(clock)
                ),
              ].filter((row) => row !== undefined),
              pagination: { count: 1, next: null },
            })
          );
        }
        const rows = [
          aliasRow("deskohub-workspace-site.vercel.app", aliasServes(clock)),
          aliasRow("workspace.deskohub.cz", customDomainStateAt(clock)),
        ].filter((row) => row !== undefined);
        return Promise.resolve(
          jsonResponse({
            aliases: rows,
            pagination: { count: rows.length, next: null },
          })
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    };
    return {
      requests,
      persisted,
      setPostStatus: (status: number) => {
        postStatus = status;
      },
      rebaseProduction: (baseline: {
        readonly id: string;
        readonly url: string;
      }) => {
        baselineDeployment = baseline;
      },
      serveAliasUntil: (flipClock: number) => {
        aliasServes = (now) => (now < flipClock ? "baseline" : "staged");
      },
      serveStagedAliasImmediately: () => {
        aliasServes = () => "staged";
      },
      restoreBaselineAlias: () => {
        aliasServes = () => "baseline";
      },
      keepCustomDomainOnBaseline: () => {
        customDomainServes = () => "baseline";
      },
      keepCustomDomainOnStaged: () => {
        customDomainServes = () => "staged";
      },
      dropCustomDomainAlias: () => {
        customDomainServes = () => "missing";
      },
      splitAliasPagesIntoTwoRequests: () => {
        splitAliasPages = true;
      },
      mockFetch,
      requestsMade: () =>
        requests.map(({ method, url }) => `${method} ${url.pathname}`),
      virtualDeps: {
        sleep: (ms: number) => {
          clock += ms;
          return Promise.resolve();
        },
        now: () => clock,
      },
      persistDeps: {
        persist: (output: string) => {
          persisted.push(output);
          return Promise.resolve();
        },
      },
    };
  };

  const promote = (
    environment: ReturnType<typeof promotionEnvironment>,
    overrides: Partial<Parameters<typeof promoteStagedDeployment>[0]> = {},
    deps: Partial<Parameters<typeof promoteStagedDeployment>[1]> = {}
  ) =>
    promoteStagedDeployment(
      {
        stagedUrl: "https://workspace-staged.vercel.app",
        token: "token",
        projectId: "prj_test",
        teamId: "team_test",
        pollDeadlineMilliseconds: 60_000,
        pollIntervalMilliseconds: 30_000,
        ...overrides,
      },
      { ...environment.virtualDeps, ...environment.persistDeps, ...deps }
    ).catch((error: Error) => {
      throw new Error(error.message);
    });

  test("promotes a ready staged deployment and reports success once every production alias serves it", async () => {
    const environment = promotionEnvironment();
    environment.serveAliasUntil(30_000);
    mockGlobalFetch(environment.mockFetch);

    const outcome = await promote(environment);

    expect(outcome).toEqual({ promoted: true });
    expect(environment.requestsMade()).toContain(
      "POST /v10/projects/prj_test/promote/dpl_staged"
    );
    expect(environment.persisted[0]).toBe(
      "baseline_url=https://workspace-baseline.vercel.app\n"
    );
    expect(environment.persisted).toContain(
      "promoted=true\npromotion_state=promoted\n"
    );
  });

  test("confirms promotion across every production alias, following alias pagination", async () => {
    const environment = promotionEnvironment();
    environment.serveAliasUntil(30_000);
    environment.splitAliasPagesIntoTwoRequests();
    mockGlobalFetch(environment.mockFetch);

    const outcome = await promote(environment);

    expect(outcome).toEqual({ promoted: true });
    const aliasRequests = environment.requests.filter(
      (request) => request.url.pathname === "/v4/aliases"
    );
    expect(aliasRequests.length).toBeGreaterThanOrEqual(2);
    expect(
      aliasRequests.some(
        (request) => request.url.searchParams.get("until") === "123"
      )
    ).toBe(true);
  });

  test("requests the promotion through the primary Vercel API, not a CLI wait", async () => {
    const source = await Bun.file(
      new URL("./production-release.ts", import.meta.url).pathname
    ).text();

    expect(source).toContain("/v10/projects/");
    expect(source).not.toMatch(/vercel@\d[\d.]* promote/);
  });

  test("refuses to promote before the staged deployment reports ready", async () => {
    const environment = promotionEnvironment();
    mockGlobalFetch((input, init) => {
      const url = new URL(input.toString());
      if (
        (init?.method ?? "GET") === "GET" &&
        url.pathname === "/v13/deployments/workspace-staged.vercel.app"
      ) {
        return Promise.resolve(
          jsonResponse({ id: "dpl_staged", readyState: "BUILDING" })
        );
      }
      return environment.mockFetch(input, init);
    });

    await expect(promote(environment)).rejects.toThrow("READY");
    expect(
      environment.requestsMade().some((request) => request.startsWith("POST"))
    ).toBe(false);
    expect(environment.persisted).toEqual([]);
  });

  test("does not request a promotion when the canonical alias already serves the staged deployment", async () => {
    const environment = promotionEnvironment();
    environment.serveStagedAliasImmediately();
    mockGlobalFetch(environment.mockFetch);

    const outcome = await promote(environment);

    expect(outcome).toEqual({ promoted: true });
    expect(
      environment.requestsMade().some((request) => request.startsWith("POST"))
    ).toBe(false);
  });

  test("fails without recovery when Vercel definitively rejects the promotion request", async () => {
    const environment = promotionEnvironment();
    environment.setPostStatus(409);
    mockGlobalFetch(environment.mockFetch);
    const rollback = mock((_: string) => Promise.resolve());

    await expect(promote(environment, {}, { rollback })).rejects.toThrow(
      "rejected the promotion request"
    );

    expect(rollback).not.toHaveBeenCalled();
    expect(environment.persisted).toContain("promotion_state=rejected\n");
  });

  test("keeps polling a pending promotion until every production alias eventually changes", async () => {
    const environment = promotionEnvironment();
    environment.serveAliasUntil(90_000);
    mockGlobalFetch(environment.mockFetch);

    const outcome = await promote(environment, {
      pollDeadlineMilliseconds: 120_000,
    });

    expect(outcome).toEqual({ promoted: true });
  });

  test("does not declare promotion while the custom production domain still serves the baseline", async () => {
    const environment = promotionEnvironment();
    environment.serveAliasUntil(30_000);
    environment.keepCustomDomainOnBaseline();
    mockGlobalFetch(environment.mockFetch);
    const rollbackUrls: string[] = [];
    const rollback = mock((url: string) => {
      rollbackUrls.push(url);
      environment.restoreBaselineAlias();
      return Promise.resolve();
    });

    await expect(promote(environment, {}, { rollback })).rejects.toThrow(
      "ambiguous"
    );

    expect(rollbackUrls).toEqual(["https://workspace-baseline.vercel.app"]);
    expect(environment.persisted).toContain("promotion_state=restored\n");
  });

  test("fails the release when the custom production domain alias is missing from the Vercel project", async () => {
    const environment = promotionEnvironment();
    environment.serveAliasUntil(30_000);
    environment.dropCustomDomainAlias();
    mockGlobalFetch(environment.mockFetch);
    const rollbackUrls: string[] = [];
    const rollback = mock((url: string) => {
      rollbackUrls.push(url);
      environment.restoreBaselineAlias();
      return Promise.resolve();
    });

    await expect(promote(environment, {}, { rollback })).rejects.toThrow(
      "workspace.deskohub.cz"
    );

    expect(rollbackUrls).toEqual(["https://workspace-baseline.vercel.app"]);
    expect(environment.persisted).not.toContain("promotion_state=restored\n");
    expect(environment.persisted).toContain(
      "promotion_state=recovery-needed\n"
    );
  });

  test("does not persist restored when rollback recovers the project alias but the customer domain still serves the staged deployment", async () => {
    const environment = promotionEnvironment();
    environment.serveAliasUntil(30_000);
    environment.keepCustomDomainOnBaseline();
    mockGlobalFetch(environment.mockFetch);
    const rollbackUrls: string[] = [];
    const rollback = mock((url: string) => {
      rollbackUrls.push(url);
      environment.restoreBaselineAlias();
      environment.keepCustomDomainOnStaged();
      return Promise.resolve();
    });

    await expect(promote(environment, {}, { rollback })).rejects.toThrow(
      "verification"
    );

    expect(rollbackUrls).toEqual(["https://workspace-baseline.vercel.app"]);
    expect(environment.persisted).not.toContain("promotion_state=restored\n");
    expect(environment.persisted).toContain(
      "promotion_state=recovery-needed\n"
    );
  });

  test("does not persist restored when the customer domain alias is missing after the rollback", async () => {
    const environment = promotionEnvironment();
    environment.serveAliasUntil(30_000);
    environment.keepCustomDomainOnBaseline();
    mockGlobalFetch(environment.mockFetch);
    const rollbackUrls: string[] = [];
    const rollback = mock((url: string) => {
      rollbackUrls.push(url);
      environment.restoreBaselineAlias();
      environment.dropCustomDomainAlias();
      return Promise.resolve();
    });

    await expect(promote(environment, {}, { rollback })).rejects.toThrow(
      "workspace.deskohub.cz"
    );

    expect(rollbackUrls).toEqual(["https://workspace-baseline.vercel.app"]);
    expect(environment.persisted).not.toContain("promotion_state=restored\n");
    expect(environment.persisted).toContain(
      "promotion_state=recovery-needed\n"
    );
  });

  test("rolls back to the baseline and verifies before failing an ambiguous promotion", async () => {
    const environment = promotionEnvironment();
    environment.setPostStatus(503);
    mockGlobalFetch(environment.mockFetch);
    const rollbackUrls: string[] = [];
    const rollback = mock((url: string) => {
      rollbackUrls.push(url);
      return Promise.resolve();
    });

    await expect(promote(environment, {}, { rollback })).rejects.toThrow(
      "rolled back"
    );

    expect(rollbackUrls).toEqual(["https://workspace-baseline.vercel.app"]);
    expect(environment.persisted[0]).toBe(
      "baseline_url=https://workspace-baseline.vercel.app\n"
    );
    expect(environment.persisted[1]).toBe("promotion_state=possibly-started\n");
    expect(environment.persisted).toContain("promotion_state=restored\n");
  });

  test("persists recovery-needed so the workflow finalizer restores the baseline when recovery verification fails", async () => {
    const environment = promotionEnvironment();
    environment.serveAliasUntil(60_000);
    mockGlobalFetch(environment.mockFetch);
    const rollbackUrls: string[] = [];
    const rollback = mock((url: string) => {
      rollbackUrls.push(url);
      return Promise.resolve();
    });

    await expect(promote(environment, {}, { rollback })).rejects.toThrow(
      "verification"
    );

    expect(environment.persisted).toContain(
      "promotion_state=recovery-needed\n"
    );

    environment.restoreBaselineAlias();
    await expect(
      verifyCanonicalAliasServes(
        "https://workspace-baseline.vercel.app",
        {
          token: "token",
          projectId: "prj_test",
          teamId: "team_test",
          pollDeadlineMilliseconds: 60_000,
          pollIntervalMilliseconds: 30_000,
        },
        environment.virtualDeps
      )
    ).resolves.toBeUndefined();
    expect(rollbackUrls).toEqual(["https://workspace-baseline.vercel.app"]);
  });

  test("recovers to the immediate pre-request baseline, never the pre-build retained target", async () => {
    const environment = promotionEnvironment();
    environment.setPostStatus(503);
    mockGlobalFetch(environment.mockFetch);
    const retained = await resolveProductionRollbackTarget(
      "token",
      "prj_test",
      "team_test"
    );
    environment.rebaseProduction({
      id: "dpl_rebased",
      url: "https://workspace-rebased.vercel.app",
    });
    const rollbackUrls: string[] = [];
    const rollback = mock((url: string) => {
      rollbackUrls.push(url);
      environment.restoreBaselineAlias();
      return Promise.resolve();
    });

    await expect(promote(environment, {}, { rollback })).rejects.toThrow(
      "rolled back"
    );

    expect(retained.url).toBe("https://workspace-baseline.vercel.app");
    expect(rollbackUrls).toEqual(["https://workspace-rebased.vercel.app"]);
    expect(environment.persisted[0]).toBe(
      "baseline_url=https://workspace-rebased.vercel.app\n"
    );
  });

  test("verifies the restored deployment across the required production aliases after rollback", async () => {
    const environment = promotionEnvironment();
    mockGlobalFetch(environment.mockFetch);

    await expect(
      verifyCanonicalAliasServes(
        "https://workspace-baseline.vercel.app",
        {
          token: "token",
          projectId: "prj_test",
          teamId: "team_test",
          pollDeadlineMilliseconds: 60_000,
          pollIntervalMilliseconds: 30_000,
        },
        environment.virtualDeps
      )
    ).resolves.toBeUndefined();
  });

  test("fails rollback verification while the customer domain still serves the staged deployment", async () => {
    const environment = promotionEnvironment();
    environment.restoreBaselineAlias();
    environment.keepCustomDomainOnStaged();
    mockGlobalFetch(environment.mockFetch);

    await expect(
      verifyCanonicalAliasServes(
        "https://workspace-baseline.vercel.app",
        {
          token: "token",
          projectId: "prj_test",
          teamId: "team_test",
          pollDeadlineMilliseconds: 60_000,
          pollIntervalMilliseconds: 30_000,
        },
        environment.virtualDeps
      )
    ).rejects.toThrow("verification");
  });

  test("fails rollback verification when the customer domain alias is missing", async () => {
    const environment = promotionEnvironment();
    environment.restoreBaselineAlias();
    environment.dropCustomDomainAlias();
    mockGlobalFetch(environment.mockFetch);

    await expect(
      verifyCanonicalAliasServes(
        "https://workspace-baseline.vercel.app",
        {
          token: "token",
          projectId: "prj_test",
          teamId: "team_test",
          pollDeadlineMilliseconds: 60_000,
          pollIntervalMilliseconds: 30_000,
        },
        environment.virtualDeps
      )
    ).rejects.toThrow("workspace.deskohub.cz");
  });

  test("fails verification when the canonical alias serves a different deployment", async () => {
    const environment = promotionEnvironment();
    environment.serveStagedAliasImmediately();
    mockGlobalFetch(environment.mockFetch);

    await expect(
      verifyCanonicalAliasServes(
        "https://workspace-baseline.vercel.app",
        {
          token: "token",
          projectId: "prj_test",
          teamId: "team_test",
          pollDeadlineMilliseconds: 60_000,
          pollIntervalMilliseconds: 30_000,
        },
        environment.virtualDeps
      )
    ).rejects.toThrow("verification");
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
