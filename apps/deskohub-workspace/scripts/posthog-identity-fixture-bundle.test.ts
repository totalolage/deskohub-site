import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { buildPosthogIdentityFixtureBundle } from "./posthog-identity-fixture-bundle";

// CI never runs the PostHog identity browser check, so this builds its fixture
// with the shared bundler setup and initializes it without `process`, failing
// when an import change leaks a module that reads server-only globals at load.
const outdir = mkdtempSync(join(tmpdir(), "posthog-identity-fixture-"));
let build: Awaited<ReturnType<typeof buildPosthogIdentityFixtureBundle>>;
let bundle = "";

beforeAll(async () => {
  build = await buildPosthogIdentityFixtureBundle(
    "https://telemetry.posthog.test",
    outdir
  );
  const output = build.outputs.find((candidate) =>
    candidate.path.endsWith(".js")
  );
  bundle = output ? await Bun.file(output.path).text() : "";
}, 60_000);

afterAll(() => rmSync(outdir, { force: true, recursive: true }));

// Web-standard APIs a browser also provides, borrowed from the runtime.
const webStandardGlobals = [
  "AbortController",
  "AbortSignal",
  "BroadcastChannel",
  "Blob",
  "CustomEvent",
  "DOMException",
  "Event",
  "EventTarget",
  "FormData",
  "Headers",
  "MessageChannel",
  "ReadableStream",
  "Request",
  "Response",
  "TextDecoder",
  "TextEncoder",
  "TransformStream",
  "URL",
  "URLSearchParams",
  "WritableStream",
  "atob",
  "btoa",
  "clearInterval",
  "clearTimeout",
  "console",
  "crypto",
  "performance",
  "queueMicrotask",
  "setInterval",
  "setTimeout",
  "structuredClone",
] as const;

/** Globals a browser offers at module init; deliberately no `process`. */
const browserLikeGlobals = () => {
  const events = new EventTarget();
  const context = {
    ...Object.fromEntries(
      webStandardGlobals.map((name) => [name, globalThis[name]])
    ),
    addEventListener: events.addEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    fetch: () => Promise.reject(new Error("no network in the bundle guard")),
    navigator: { language: "en-US", userAgent: "bundle-guard" },
    removeEventListener: events.removeEventListener.bind(events),
  };
  return Object.assign(context, {
    globalThis: context,
    self: context,
    window: context,
  });
};

test("builds the fixture bundle with the browser check's bundler setup", () => {
  expect(build.success).toBe(true);
  expect(bundle.length).toBeGreaterThan(0);
});

test("initializes the fixture bundle without process or a DOM", () => {
  // The bundle ends with an ESM export list; the rest is a classic script.
  const script = bundle.replace(/\nexport \{[^}]*\};?\s*$/, "\n");
  expect(() =>
    runInNewContext(script, browserLikeGlobals(), {
      filename: "posthog-identity-browser-fixture.js",
    })
  ).not.toThrow();
});
