import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  addRedaction,
  makePlaywrightBrowserRunner,
  type Runner,
} from "./runtime";

// The argv runner is a shim over the browser session until every caller
// drives the session; these pin its commands against a real Chromium.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let artifactDir = "";
const previewProbes: Record<string, string>[] = [];

beforeAll(async () => {
  if (!chromiumAvailable) return;
  artifactDir = await mkdtemp(join(tmpdir(), "browser-runner-test-"));
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/favicon.svg") {
        previewProbes.push(
          Object.fromEntries(
            [...request.headers].filter(([name]) => name.startsWith("x-"))
          )
        );
        return new Response("<svg/>", {
          headers: { "content-type": "image/svg+xml" },
        });
      }
      return new Response(
        pathname === "/popup"
          ? "<!doctype html><title>Popup</title>"
          : `<!doctype html><title>Checkout</title>
            <button id="popup" onclick="window.open('/popup')">Open</button>
            <iframe id="card" srcdoc="<input id='holder' aria-label='Holder'>"></iframe>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    },
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
  if (artifactDir) await rm(artifactDir, { force: true, recursive: true });
});

const origin = () => {
  if (!server) throw new Error("test server is not running");
  return `http://localhost:${server.port}`;
};

const withRunner = async <A>(body: (run: Runner) => Promise<A>) => {
  if (!browser) throw new Error("Chromium is not running");
  const run = makePlaywrightBrowserRunner(browser);
  try {
    return await body(run);
  } finally {
    await run.close?.();
  }
};

const command = async (
  run: Runner,
  session: string,
  args: string[],
  input?: string
) =>
  (
    await run("playwright", ["--session", session, ...args], {
      input,
      logCommand: false,
      logOutput: false,
      timeoutMs: 5000,
    })
  ).stdout;

test.skipIf(!chromiumAvailable)(
  "drives argv commands and the bridged session in one context",
  async () => {
    const session = `bridge-${randomUUID()}`;
    const outcome = await withRunner(async (run) => {
      await command(run, session, ["open", `${origin()}/`]);
      const browserSession = await Effect.runPromise(
        run.session?.(session) ?? Effect.die("runner bridge missing")
      );
      const title = await Effect.runPromise(
        browserSession.use("read the title", (page) => page.title())
      );
      await Effect.runPromise(
        browserSession.setSessionCookie({
          name: "session_token",
          url: "https://workspace.example.test",
          value: "synthetic-session-value",
        })
      );
      const cookie = await command(
        run,
        session,
        ["cookie", "get", "--stdin"],
        JSON.stringify({
          name: "session_token",
          url: "https://workspace.example.test/en-US",
          value: "synthetic-session-value",
        })
      );
      return { cookie, title };
    });

    expect(outcome.title).toBe("Checkout");
    expect(JSON.parse(outcome.cookie)).toEqual({
      httpOnly: true,
      lifetimeDays: null,
      matches: true,
      path: "/",
      present: true,
      sameSite: "Lax",
      secure: true,
    });
    expect(outcome.cookie).not.toContain("synthetic-session-value");
  }
);

test.skipIf(!chromiumAvailable)(
  "targets the selected frame and switches tabs by id",
  async () => {
    const session = `tabs-${randomUUID()}`;
    const outcome = await withRunner(async (run) => {
      await command(run, session, ["open", `${origin()}/`]);
      await command(run, session, ["frame", "#card"]);
      await command(run, session, ["fill", "#holder", "Synthetic Holder"]);
      const holder = await command(run, session, ["get", "value", "#holder"]);
      await command(run, session, ["frame", "main"]);
      await command(run, session, ["click", "#popup"]);
      const browserSession = await Effect.runPromise(
        run.session?.(session) ?? Effect.die("runner bridge missing")
      );
      await Effect.runPromise(
        browserSession.use("await the popup", async (page) => {
          if (page.context().pages().length < 2)
            await page.context().waitForEvent("page");
        })
      );
      await command(run, session, [
        "wait",
        "--fn",
        "document.readyState === 'complete'",
      ]);
      const tabs = JSON.parse(
        await command(run, session, ["--json", "tab", "list"])
      );
      const popupUrl = await command(run, session, ["get", "url"]);
      await command(run, session, ["tab", "t1"]);
      const checkoutUrl = await command(run, session, ["get", "url"]);
      await command(run, session, ["tab", "close", "t2"]);
      const remaining = JSON.parse(
        await command(run, session, ["--json", "tab", "list"])
      );
      return { checkoutUrl, holder, popupUrl, remaining, tabs };
    });

    expect(outcome.holder).toBe("Synthetic Holder");
    expect(outcome.tabs).toEqual({
      data: {
        tabs: [
          { active: false, tabId: "t1" },
          { active: true, tabId: "t2" },
        ],
      },
      success: true,
    });
    expect(outcome.popupUrl).toBe(`${origin()}/popup`);
    expect(outcome.checkoutUrl).toBe(`${origin()}/`);
    expect(outcome.remaining).toEqual({
      data: { tabs: [{ active: true, tabId: "t1" }] },
      success: true,
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "drops the selected frame when another page becomes active",
  async () => {
    const session = `frame-reset-${randomUUID()}`;
    const afterPopup = await withRunner(async (run) => {
      await command(run, session, ["open", `${origin()}/`]);
      await command(run, session, ["frame", "#card"]);
      const browserSession = await Effect.runPromise(
        run.session?.(session) ?? Effect.die("runner bridge missing")
      );
      await Effect.runPromise(
        browserSession.use("open and close the popup", async (page) => {
          const [popup] = await Promise.all([
            page.waitForEvent("popup"),
            page.click("#popup"),
          ]);
          await popup.close();
        })
      );
      return run(
        "playwright",
        ["--session", session, "get", "value", "#holder"],
        {
          allowFailure: true,
          logCommand: false,
          logOutput: false,
          timeoutMs: 500,
        }
      );
    });

    expect(afterPopup.exitCode).toBe(1);
    expect(afterPopup.stderr).toContain("Timeout 500ms exceeded");
  }
);

test.skipIf(!chromiumAvailable)(
  "stops the HAR into a sanitized file and closes the session",
  async () => {
    const session = `har-${randomUUID()}`;
    const secret = "synthetic-runner-har-secret";
    addRedaction(secret);
    const harPath = join(artifactDir, `${session}.har`);
    const afterStop = await withRunner(async (run) => {
      await command(run, session, ["open", `${origin()}/?token=${secret}`]);
      await command(run, session, ["network", "har", "stop", harPath]);
      return run("playwright", ["--session", session, "eval", "--stdin"], {
        allowFailure: true,
        input: "document.title",
        logCommand: false,
        logOutput: false,
      });
    });

    const har = await readFile(harPath, "utf8");
    expect(JSON.parse(har).log.entries.length).toBeGreaterThan(0);
    expect(har).not.toContain(secret);
    expect(afterStop.exitCode).toBe(1);
  }
);

test.skipIf(!chromiumAvailable)(
  "probes preview access with any --headers map, forwarding every header",
  async () => {
    previewProbes.length = 0;
    const bypassHeaders = {
      "x-e2e-extra": "kept",
      "x-vercel-protection-bypass": "synthetic-runner-bypass",
      "x-vercel-set-bypass-cookie": "true",
    };
    const otherHeaders = { "X-E2E-Probe": "kept" };
    const openedUrls = await withRunner(async (run) =>
      Promise.all(
        [bypassHeaders, otherHeaders].map((headers) =>
          command(run, `headers-${randomUUID()}`, [
            "--headers",
            JSON.stringify(headers),
            "open",
            `${origin()}/`,
          ])
        )
      )
    );

    expect(openedUrls).toEqual([`${origin()}/`, `${origin()}/`]);
    expect(previewProbes).toEqual(
      expect.arrayContaining([bypassHeaders, { "x-e2e-probe": "kept" }])
    );
    expect(previewProbes).toHaveLength(2);
  }
);
