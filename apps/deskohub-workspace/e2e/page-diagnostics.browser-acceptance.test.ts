import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { watchPageDiagnostics } from "./page-diagnostics";

// A page whose parser-blocking polyfill fails, as a `<head>` loader's does
// when its request is aborted: the diagnostics must name the page error, the
// failed and erroring requests, and the document state, without the origin.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/polyfill.js") return new Response("unreachable");
      if (pathname === "/static/app.js")
        return new Response(
          "if (!globalThis.Polyfilled) throw new Error('Polyfill is missing');",
          { headers: { "content-type": "text/javascript" } }
        );
      if (pathname === "/static/style.js")
        return new Response("", {
          headers: { "content-type": "text/javascript" },
        });
      if (pathname === "/static/missing.js")
        return new Response("not found", { status: 404 });
      return new Response(
        `<!doctype html><html><head><script src="/polyfill.js"></script></head>
        <body><script src="/static/app.js"></script><script src="/static/style.js"></script>
        <script src="/static/missing.js"></script></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    },
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
});

test.skipIf(!chromiumAvailable)(
  "describes page errors, watched request outcomes, and the page state",
  async () => {
    if (!(browser && server)) throw new Error("setup did not run");
    const page = await browser.newPage();
    try {
      await page.route("**/polyfill.js", (route) => route.abort("failed"));
      const diagnostics = watchPageDiagnostics(page, {
        Polyfill: (url) => url.pathname === "/polyfill.js",
        "App scripts": (url, resourceType) =>
          resourceType === "script" && url.pathname.startsWith("/static/"),
        Documents: (_url, resourceType) => resourceType === "document",
      });
      await page.goto(server.url.origin);

      const description = await diagnostics.describe(["Polyfilled"]);

      expect(diagnostics.pageErrors()).toHaveLength(1);
      const lines = description.split("\n");
      expect(lines).toContain("Page errors:");
      expect(lines).toContain("Polyfill: 1 requests");
      expect(
        lines.some((line) =>
          /^ {2}- \/polyfill\.js: failed \(.+\), no response after \d+ ms$/.test(
            line
          )
        )
      ).toBe(true);
      expect(lines).toContain("App scripts: 3 requests");
      expect(
        lines.some((line) =>
          // Chromium also fails a script request that answered 404.
          /^ {2}- \/static\/missing\.js: (?:failed \(.+\), )?status 404 after \d+ ms$/.test(
            line
          )
        )
      ).toBe(true);
      expect(
        lines.some((line) =>
          /^ {2}- \/static\/app\.js: status 200 after \d+ ms$/.test(line)
        )
      ).toBe(true);
      expect(lines).toContain(
        "Page state: readyState=complete, Next.js runtime=not started, Polyfilled=undefined"
      );
      expect(description).not.toContain(server.url.host);
    } finally {
      await page.close();
    }
  },
  30_000
);

test.skipIf(!chromiumAvailable)(
  "lists only the problems of a larger request group",
  async () => {
    if (!(browser && server)) throw new Error("setup did not run");
    const page = await browser.newPage();
    try {
      const diagnostics = watchPageDiagnostics(page, {
        Everything: () => true,
      });
      await page.goto(server.url.origin);

      const lines = (await diagnostics.describe()).split("\n");

      expect(lines).toContain("Everything: 5 requests, 4 succeeded");
      expect(
        lines
          .filter((line) => line.startsWith("  - /"))
          .map((line) => line.replace(/: .* after \d+ ms$/, ""))
      ).toEqual(["  - /static/missing.js"]);
    } finally {
      await page.close();
    }
  },
  30_000
);
