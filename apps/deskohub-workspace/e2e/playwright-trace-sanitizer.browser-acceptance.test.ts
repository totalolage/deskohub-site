import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { unzipSync } from "fflate";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { sanitizePlaywrightTraceFile } from "./playwright-trace-sanitizer";
import { addRedaction } from "./redaction";

// Records a real Chromium trace that holds every kind of value the preview
// runs put in one: an added cookie, a served cookie, credential headers, a
// registered secret in a response body, the DOM, the console, and a query,
// and the preview origin. The sanitized archive must hold none of them in any
// entry, by name or bytes. Screenshot pixels that render the secret are out of
// reach of any byte check; see `sanitizePlaywrightTrace`.
const chromiumAvailable = await playwrightChromiumAvailable();
const values = {
  addedCookie: `added-${randomUUID()}`,
  authorization: `auth-${randomUUID()}`,
  bypass: `bypass-${randomUUID()}`,
  registered: `registered-${randomUUID()}`,
  servedCookie: `served-${randomUUID()}`,
};
let browser: Browser | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let directory: string | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  addRedaction(values.registered);
  browser = await chromium.launch({ headless: true });
  directory = await mkdtemp(join(tmpdir(), "trace-sanitizer-"));
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/data")
        return Response.json({ secret: values.registered });
      return new Response(
        `<!doctype html><title>Trace</title>
        <p>${values.registered}</p>
        <a href="/next?code=${values.registered}">Next</a>
        <button onclick="fetch('/data').then((r) => r.json()).then((d) => console.log(d.secret))">Load</button>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "set-cookie": `served=${values.servedCookie}; Path=/; HttpOnly`,
          },
        }
      );
    },
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
  if (directory) await rm(directory, { force: true, recursive: true });
});

const recordTrace = async (origin: string, path: string) => {
  if (!browser) throw new Error("Chromium did not start");
  const context = await browser.newContext({
    extraHTTPHeaders: {
      authorization: `Bearer ${values.authorization}`,
      "x-vercel-protection-bypass": values.bypass,
    },
  });
  try {
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    await context.addCookies([
      { name: "_vercel_jwt", url: origin, value: values.addedCookie },
    ]);
    const page = await context.newPage();
    const logged = page.waitForEvent("console");
    await page.goto(origin);
    await page.getByRole("button", { name: "Load" }).click();
    await logged;
    await context.tracing.stop({ path });
  } finally {
    await context.close();
  }
};

const readEntries = async (path: string) =>
  Object.entries(unzipSync(await readFile(path))).map(([name, bytes]) => ({
    name,
    text: Buffer.from(bytes).toString("latin1"),
  }));

/** The kinds of entries that hold `value`: event files by name, resources together. */
const holders = (
  entries: readonly { name: string; text: string }[],
  value: string
) =>
  [
    ...new Set(
      entries
        .filter(
          ({ name, text }) => name.includes(value) || text.includes(value)
        )
        .map(({ name }) => (name.startsWith("resources/") ? "resources" : name))
    ),
  ].sort();

test.skipIf(!chromiumAvailable)(
  "removes cookies, credentials, secrets, and the preview origin from every trace entry",
  async () => {
    if (!(server && directory)) throw new Error("setup did not run");
    const origin = server.url.origin;
    const host = server.url.host;
    const path = join(directory, "trace.zip");
    await recordTrace(origin, path);

    // The raw trace holds each value where a preview run's would.
    const raw = await readEntries(path);
    expect(holders(raw, values.addedCookie)).toEqual([
      "trace.network",
      "trace.trace",
    ]);
    expect(holders(raw, values.servedCookie)).toContain("trace.network");
    expect(holders(raw, values.authorization)).toContain("trace.network");
    expect(holders(raw, values.bypass)).toContain("trace.network");
    expect(holders(raw, values.registered)).toEqual(
      expect.arrayContaining(["resources", "trace.trace"])
    );
    expect(holders(raw, host)).toEqual(
      expect.arrayContaining(["trace.network", "trace.trace"])
    );

    const sanitization = sanitizePlaywrightTraceFile(path, {
      origins: [origin],
    });
    if (sanitization.outcome !== "sanitized")
      throw new Error(`deleted: ${sanitization.reason}`);
    expect(await Bun.file(path).exists()).toBe(false);

    const sanitized = await readEntries(sanitization.path);
    for (const value of [...Object.values(values), host])
      expect({ value, holders: holders(sanitized, value) }).toEqual({
        value,
        holders: [],
      });

    // It is still a trace: the calls, snapshots, screenshots, and network
    // entries remain.
    const trace = sanitized.find((entry) => entry.name === "trace.trace");
    const network = sanitized.find((entry) => entry.name === "trace.network");
    const types = (text = "") =>
      new Set(
        text
          .split("\n")
          .filter(Boolean)
          .map((line) => (JSON.parse(line) as { type: string }).type)
      );
    expect([...types(trace?.text)]).toEqual(
      expect.arrayContaining([
        "before",
        "console",
        "frame-snapshot",
        "screencast-frame",
      ])
    );
    expect([...types(network?.text)]).toEqual(["resource-snapshot"]);
    expect(
      sanitized.some(
        ({ name }) => name.startsWith("resources/") && name.endsWith(".jpeg")
      )
    ).toBe(true);
  },
  30_000
);
