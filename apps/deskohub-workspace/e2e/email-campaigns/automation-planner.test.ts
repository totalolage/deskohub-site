import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import {
  automationPlannerPath,
  resolveWorkspaceE2ECronSecret,
  tickAutomationPlanner,
} from "./automation-planner";

const syntheticCronSecret = "synthetic-cron-sentinel-81d0c4";
const syntheticBypass = "synthetic-bypass-sentinel-5e27aa";
const deploymentOrigin =
  "https://deskohub-workspace-site-abc123xyz-filip-kalny-projects.vercel.app";

const recordingFetch = (respond: () => Promise<Response>) => {
  const requests: { readonly headers: Headers; readonly url: string }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ headers: new Headers(init?.headers), url: String(url) });
    return respond();
  }) as typeof globalThis.fetch;
  return { fetch, requests };
};

const tick = (
  origin: string,
  fetch: typeof globalThis.fetch,
  bypassSecret: string | undefined = syntheticBypass
) =>
  Effect.runPromiseExit(
    tickAutomationPlanner({
      bypassSecret,
      cronSecret: { value: syntheticCronSecret },
      fetch,
      origin,
      timeoutMs: 1_000,
    })
  );

const failureMessage = (exit: Exit.Exit<unknown, unknown>) =>
  JSON.stringify(Exit.isFailure(exit) ? exit.cause : undefined);

test("fails closed without the Preview cron secret", () => {
  expect(() =>
    resolveWorkspaceE2ECronSecret({ WORKSPACE_E2E_CRON_SECRET: undefined })
  ).toThrow();
});

test("calls the planner cron route as Vercel Cron does", async () => {
  const { fetch, requests } = recordingFetch(
    async () => new Response("{}", { status: 200 })
  );

  const exit = await tick(deploymentOrigin, fetch);

  expect(Exit.isSuccess(exit)).toBe(true);
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]?.url ?? "").pathname).toBe(automationPlannerPath);
  expect(requests[0]?.headers.get("authorization")).toBe(
    `Bearer ${syntheticCronSecret}`
  );
  expect(requests[0]?.headers.get("x-vercel-protection-bypass")).toBe(
    syntheticBypass
  );
});

test("sends the protection bypass only to a Workspace deployment", async () => {
  const { fetch, requests } = recordingFetch(
    async () => new Response("{}", { status: 200 })
  );

  await tick("http://localhost:3000", fetch);

  expect(requests[0]?.headers.has("x-vercel-protection-bypass")).toBe(false);
});

test("reports a refused tick by status alone", async () => {
  const { fetch } = recordingFetch(
    async () => new Response("Unauthorized", { status: 401 })
  );

  const exit = await tick(deploymentOrigin, fetch);

  expect(Exit.isFailure(exit)).toBe(true);
  expect(failureMessage(exit)).toContain("401");
  expect(failureMessage(exit)).not.toContain(syntheticCronSecret);
});

test("keeps both secrets out of a failed request's error", async () => {
  const { fetch } = recordingFetch(async () => {
    throw new Error(
      `fetch failed: authorization: Bearer ${syntheticCronSecret} x-vercel-protection-bypass: ${syntheticBypass}`
    );
  });

  const exit = await tick(deploymentOrigin, fetch);

  expect(Exit.isFailure(exit)).toBe(true);
  expect(failureMessage(exit)).not.toContain(syntheticCronSecret);
  expect(failureMessage(exit)).not.toContain(syntheticBypass);
});
