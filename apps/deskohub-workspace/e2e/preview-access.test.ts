import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type BrowserContext, chromium } from "@playwright/test";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { primePreviewAccess } from "./preview-access";

const syntheticSecret = "synthetic-bypass-sentinel-3f9c2a";
const syntheticJwt = "synthetic-vercel-jwt-7d41";
const deploymentOrigin =
  "https://deskohub-workspace-site-abc123xyz-filip-kalny-projects.vercel.app";

type AddedCookies = Parameters<BrowserContext["addCookies"]>[0];

const recordingContext = () => {
  const added: AddedCookies[] = [];
  return {
    added,
    context: {
      addCookies: async (cookies: AddedCookies) => {
        added.push(cookies);
      },
    },
  };
};

const bypassRedirect = () =>
  new Response(null, {
    headers: [
      ["location", "/favicon.svg"],
      [
        "set-cookie",
        `_vercel_jwt=${syntheticJwt}; Max-Age=604800; Path=/; Secure; HttpOnly; SameSite=Lax`,
      ],
    ],
    status: 307,
  });

const recordingFetch = (respond: () => Promise<Response>) => {
  const requests: Array<{ init: RequestInit | undefined; url: string }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ init, url: String(url) });
    return respond();
  }) as typeof globalThis.fetch;
  return { fetch, requests };
};

test.each([
  "http://localhost:3110",
  "http://127.0.0.1:3000",
  "https://deskohub-workspace-site-git-feature-filip-kalny-projects.vercel.app",
  "https://other-project-abc123xyz-filip-kalny-projects.vercel.app",
  "https://deskohub-workspace-site-abc123xyz-filip-kalny-projects.vercel.app:8443",
  "http://deskohub-workspace-site-abc123xyz-filip-kalny-projects.vercel.app",
  "https://deskohub.cz",
])("never sends the bypass secret to %s", async (origin) => {
  const { added, context } = recordingContext();
  const { fetch, requests } = recordingFetch(async () => bypassRedirect());

  await primePreviewAccess(context, origin, syntheticSecret, { fetch });

  expect(requests).toEqual([]);
  expect(added).toEqual([]);
});

test("does nothing without a bypass secret", async () => {
  const { added, context } = recordingContext();
  const { fetch, requests } = recordingFetch(async () => bypassRedirect());

  await primePreviewAccess(context, deploymentOrigin, undefined, { fetch });

  expect(requests).toEqual([]);
  expect(added).toEqual([]);
});

test("exchanges the secret for the bypass cookie outside the browser context", async () => {
  const { added, context } = recordingContext();
  const { fetch, requests } = recordingFetch(async () => bypassRedirect());

  await primePreviewAccess(
    context,
    `${deploymentOrigin}/en-US`,
    syntheticSecret,
    { fetch }
  );

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(`${deploymentOrigin}/favicon.svg`);
  expect(requests[0]?.init?.redirect).toBe("manual");
  expect(requests[0]?.init?.headers).toEqual({
    "x-vercel-protection-bypass": syntheticSecret,
    "x-vercel-set-bypass-cookie": "true",
  });
  expect(added).toEqual([
    [
      {
        expires: expect.any(Number),
        httpOnly: true,
        name: "_vercel_jwt",
        sameSite: "Lax",
        url: deploymentOrigin,
        value: syntheticJwt,
      },
    ],
  ]);
  expect(JSON.stringify(added)).not.toContain(syntheticSecret);
});

test("keeps the secret out of a failed bypass request's error", async () => {
  const { added, context } = recordingContext();
  const { fetch } = recordingFetch(async () => {
    throw new TypeError(
      `fetch failed: x-vercel-protection-bypass: ${syntheticSecret}`
    );
  });

  const error = await primePreviewAccess(
    context,
    deploymentOrigin,
    syntheticSecret,
    { fetch }
  ).catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).cause).toBeUndefined();
  expect(Bun.inspect(error)).not.toContain(syntheticSecret);
  expect(added).toEqual([]);
});

test("reports a rejected bypass by status alone", async () => {
  const { added, context } = recordingContext();
  const { fetch } = recordingFetch(
    async () =>
      new Response(`denied ${syntheticSecret}`, {
        headers: { "x-echo": syntheticSecret },
        status: 401,
      })
  );

  const error = await primePreviewAccess(
    context,
    deploymentOrigin,
    syntheticSecret,
    { fetch }
  ).catch((cause: unknown) => cause);

  expect((error as Error).message).toBe(
    "The Vercel protection bypass probe failed with 401"
  );
  expect(Bun.inspect(error)).not.toContain(syntheticSecret);
  expect(added).toEqual([]);
});

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let tracesDir: string | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  tracesDir = await mkdtemp(join(tmpdir(), "preview-access-trace-"));
  browser = await chromium.launch({ headless: true, tracesDir });
});

afterAll(async () => {
  await browser?.close();
  if (tracesDir) await rm(tracesDir, { force: true, recursive: true });
});

test.skipIf(!chromiumAvailable)(
  "keeps the secret out of a traced browser context",
  async () => {
    if (!(browser && tracesDir)) throw new Error("Chromium is not launched.");
    const context = await browser.newContext();
    await context.tracing.start({ name: "preview-access", snapshots: true });
    await primePreviewAccess(context, deploymentOrigin, syntheticSecret, {
      fetch: recordingFetch(async () => bypassRedirect()).fetch,
    });
    await primePreviewAccess(context, deploymentOrigin, syntheticSecret, {
      fetch: recordingFetch(async () => new Response(null, { status: 401 }))
        .fetch,
    }).catch(() => undefined);
    const cookies = await context.cookies(deploymentOrigin);
    await context.tracing.stop({
      path: join(tracesDir, "preview-access.zip"),
    });
    await context.close();

    expect(cookies.map(({ name }) => name)).toEqual(["_vercel_jwt"]);
    // The raw trace files stay beside the archive. The cookie the trace
    // recorded shows the scan reads what Playwright captured.
    const traced = await Promise.all(
      (await readdir(tracesDir))
        .filter((name) => /\.(?:network|trace)$/.test(name))
        .map((name) => readFile(join(tracesDir as string, name), "utf8"))
    );
    expect(traced.join("\n")).toContain(syntheticJwt);
    expect(traced.join("\n")).not.toContain(syntheticSecret);
  }
);
