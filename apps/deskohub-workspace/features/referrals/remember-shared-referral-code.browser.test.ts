import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { referralCodeCookieName } from "./referral-code-cookie";

type Evidence = {
  readonly cookie: string;
  readonly framed: boolean;
  readonly initiallyPrerendered: boolean;
};

const chromiumAvailable = await playwrightChromiumAvailable();
let buildDirectory = "";
let bundle = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "referral-prerender-"));
  const build = await Bun.build({
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    entrypoints: [
      join(
        import.meta.dir,
        "remember-shared-referral-code.browser-harness.tsx"
      ),
    ],
    format: "iife",
    minify: true,
    naming: "harness.js",
    outdir: buildDirectory,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  bundle = await Bun.file(join(buildDirectory, "harness.js")).text();
});

afterAll(async () => {
  if (buildDirectory) {
    await rm(buildDirectory, { force: true, recursive: true });
  }
});

/**
 * Serves `startPage` at /start and the referral page behind the real proxy,
 * recording whether the proxy set the code and what the mounted component
 * reported.
 */
const serveHarness = (startPage: string) => {
  const proxyCaptures: boolean[] = [];
  const evidence = Promise.withResolvers<Evidence>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/start") {
        return new Response(startPage, {
          headers: { "content-type": "text/html" },
        });
      }
      if (url.pathname === "/evidence") {
        evidence.resolve((await request.json()) as Evidence);
        return new Response("ok");
      }
      if (url.pathname === "/harness.js") {
        return new Response(bundle, {
          headers: { "content-type": "text/javascript" },
        });
      }
      if (url.pathname !== "/en-US/account") {
        return new Response("", { status: 404 });
      }
      const response = await proxy(new NextRequest(request));
      proxyCaptures.push(response.cookies.has(referralCodeCookieName));
      const headers = new Headers(response.headers);
      headers.set("content-type", "text/html");
      return new Response(
        `<!doctype html><html><body><div id="root"></div><script src="/harness.js"></script></body></html>`,
        { headers, status: response.status }
      );
    },
  });
  const reported = Promise.race([
    evidence.promise,
    Bun.sleep(30_000).then(() => {
      throw new Error("The shown page reported nothing.");
    }),
  ]);
  return { proxyCaptures, reported, server };
};

test.skipIf(!chromiumAvailable)(
  "remembers a shared code when Chrome activates a page it prerendered",
  async () => {
    const target = "/en-US/account?ref=RFLFIRST1";
    // Chrome prerenders only for a page it was not told to automate, so the
    // browser runs natively instead of under Playwright's DevTools control.
    const { proxyCaptures, reported, server } = serveHarness(
      `<!doctype html><html><body><a id="go" href="${target}">Visit</a><script type="speculationrules">${JSON.stringify({ prerender: [{ eagerness: "immediate", urls: [target] }] })}</script><script>setTimeout(() => document.getElementById("go").click(), 2000)</script></body></html>`
    );
    const profile = await mkdtemp(join(tmpdir(), "referral-prerender-chrome-"));
    const browser = Bun.spawn(
      [
        chromium.executablePath(),
        "--headless",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        `--user-data-dir=${profile}`,
        new URL("/start", server.url).href,
      ],
      { stderr: "ignore", stdout: "ignore" }
    );
    try {
      const shown = await reported;

      expect(shown.initiallyPrerendered).toBe(true);
      // Only the shown page remembers the code, never the proxy.
      expect(proxyCaptures).toEqual([false]);
      expect(shown.cookie).toContain(`${referralCodeCookieName}=RFLFIRST1`);
    } finally {
      browser.kill();
      await browser.exited;
      server.stop(true);
      await rm(profile, { force: true, recursive: true });
    }
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "does not remember a shared code from a page shown inside a frame",
  async () => {
    const { proxyCaptures, reported, server } = serveHarness(
      `<!doctype html><html><body><iframe src="/en-US/account?ref=RFLFRAME1"></iframe></body></html>`
    );
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(new URL("/start", server.url).href);
      const shown = await reported;

      expect(shown.framed).toBe(true);
      expect(proxyCaptures).toEqual([false]);
      expect(shown.cookie).not.toContain(referralCodeCookieName);
      expect(
        (await page.context().cookies()).map(({ name }) => name)
      ).not.toContain(referralCodeCookieName);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60_000
);
