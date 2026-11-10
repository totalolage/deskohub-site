import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { strToU8, zipSync } from "fflate";
import {
  accountDataExportManifestPath,
  accountDataExportSchemaVersion,
  accountDataExportSections,
} from "@/features/account/account-data-export-sections";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  type BrowserStepDriver,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import type { WorkspaceE2EError } from "../errors";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  findAccountDataExportDeliveryProblem,
  findSignedOutAccountDataExportProblem,
} from "./account-data-export";
import {
  makeWorkspaceE2EAccountLaneBrowser,
  type WorkspaceE2EAccountLaneBrowser,
} from "./lane-browser";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

const exportPath = "/en-US/account/data-export";
const filename = "deskohub-account-data-2026-11-09.zip";
const signedInCookie = "lane-signed-in=1";

const archive = zipSync({
  ...Object.fromEntries(
    accountDataExportSections.map(({ path }) => [path, strToU8("[]")])
  ),
  [accountDataExportManifestPath]: strToU8(
    JSON.stringify({ schemaVersion: accountDataExportSchemaVersion })
  ),
});

const privateHeaders = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
};

/**
 * The legal page's export block as the account UI renders it: a hydrated
 * button that fetches the export, saves a ZIP attachment through a detached
 * download link named from its Content-Disposition, and settles the block on
 * delivered, or on error for anything else. Loading the page signs the
 * browser in; `?fail=1` makes the export fail, `?delayMs=` delays its
 * response, `?streamed=1` streams its body in chunks, `?unsaved=1` makes the
 * control skip the save, and `?hidden=1` hides the action so it cannot be
 * clicked.
 */
const legalPage = (url: URL) => {
  const fail = url.searchParams.get("fail") === "1";
  const delayMs = Number(url.searchParams.get("delayMs") ?? "0");
  const hidden = url.searchParams.get("hidden") === "1" ? " hidden" : "";
  const streamed = url.searchParams.get("streamed") === "1";
  const unsaved = url.searchParams.get("unsaved") === "1";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <section data-slot="account-data-export" data-state="idle">
      <button type="button" data-slot="account-data-export-action"${hidden}>Download</button>
      <p data-slot="account-data-export-status" role="status"></p>
    </section>
    <script>
      document.cookie = "${signedInCookie}; path=/";
      document.cookie = "export-fail=${fail ? "1" : "0"}; path=/";
      document.cookie = "export-delay=${delayMs}; path=/";
      document.cookie = "export-streamed=${streamed ? "1" : "0"}; path=/";
      const block = document.querySelector('[data-slot="account-data-export"]');
      const action = document.querySelector('[data-slot="account-data-export-action"]');
      action.__reactProps$test = { onClick: () => {} };
      action.addEventListener("click", async () => {
        block.dataset.state = "pending";
        try {
          const response = await fetch(${JSON.stringify(exportPath)}, { cache: "no-store", credentials: "same-origin" });
          const disposition = response.headers.get("content-disposition") ?? "";
          if (!response.ok || response.headers.get("content-type") !== "application/zip" || !disposition.startsWith("attachment")) {
            block.dataset.state = "error";
            return;
          }
          const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "fallback.zip";
          const link = document.createElement("a");
          link.href = URL.createObjectURL(await response.blob());
          link.download = name;
          if (!${unsaved}) link.click();
          block.dataset.state = "delivered";
        } catch {
          block.dataset.state = "error";
        }
      });
    </script></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
};

/**
 * The archive as a body sent in several chunks, the way a deployed function
 * streams it. Chromium then keeps no copy of the body for Playwright's
 * `response.body()` once the page consumed it, so only the download holds it.
 */
const streamedArchive = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let start = 0; start < archive.length; start += 64)
        controller.enqueue(archive.slice(start, start + 64));
      controller.close();
    },
  });

/** The export route: the signed-in browser's archive, else a private 404. */
const exportRoute = async (request: Request) => {
  const cookie = request.headers.get("cookie") ?? "";
  const delayMs = Number(/export-delay=(\d+)/.exec(cookie)?.[1] ?? "0");
  if (delayMs > 0) await Bun.sleep(delayMs);
  if (!cookie.includes(signedInCookie))
    return new Response(null, { headers: privateHeaders, status: 404 });
  if (cookie.includes("export-fail=1"))
    return new Response("Export unavailable", {
      headers: privateHeaders,
      status: 500,
    });
  const streamed = cookie.includes("export-streamed=1");
  return new Response(streamed ? streamedArchive() : archive, {
    headers: {
      ...privateHeaders,
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "application/zip",
    },
  });
};

const server = Bun.serve({
  fetch: (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/en-US/account/legal") return legalPage(url);
    if (url.pathname === exportPath) return exportRoute(request);
    return new Response(null, { status: 404 });
  },
  port: 0,
});

const origin = server.url.origin;

afterAll(async () => {
  await browser?.close();
  await server.stop(true);
});

const config = {
  baseUrl: origin,
  bypassSecret: undefined,
  timeouts: {
    ...workspaceE2ETimeouts,
    browserAction: 2000,
    browserNavigation: 3000,
    browserSessionClose: 1000,
    // Bounds how long a missing download is waited for.
    datasource: 4000,
    uiTransition: 2000,
  },
};

/** Runs `drive` on the lane browser over a fresh session as one C03 step. */
const runLaneStep = <A>(
  drive: (
    laneBrowser: WorkspaceE2EAccountLaneBrowser,
    driver: BrowserStepDriver
  ) => Effect.Effect<A, WorkspaceE2EError>
) => {
  if (!browser) throw new Error("Chromium is not running");
  return runBrowserStep({
    browser,
    drive: (driver) =>
      Effect.flatMap(
        Effect.cached(driver.openSeparateSession("assistant")),
        (openAssistantSession) =>
          drive(
            makeWorkspaceE2EAccountLaneBrowser({
              config,
              openAssistantSession,
              openSeparateSession: driver.openSeparateSession,
              openSession: driver.openSession,
            }),
            driver
          )
      ),
    prepare: () => Effect.void,
    stepTimeoutMs: 20_000,
  });
};

test.skipIf(!chromiumAvailable)(
  "downloads the export through the control and leaves the lane signed in while a signed-out visitor is refused",
  async () => {
    const real = browser;
    if (!real) throw new Error("Chromium is not running");
    const result = await runLaneStep((laneBrowser, { session }) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/account/legal`);
        const delivery =
          yield* laneBrowser.downloadAccountDataExport(exportPath);
        const contextsBefore = real.contexts().length;
        const refusal =
          yield* laneBrowser.requestAccountDataExportSignedOut(exportPath);
        const contextsAfter = real.contexts().length;
        const laneCookies = yield* session.use("read lane cookies", (page) =>
          page.context().cookies()
        );
        return {
          contextsAfter,
          contextsBefore,
          delivery,
          laneSignedIn: laneCookies.some(
            ({ name, value }) => `${name}=${value}` === signedInCookie
          ),
          refusal,
        };
      })
    );

    expect(result.failures).toEqual([]);
    expect(result.succeeded).toBe(true);
    const value = result.value;
    if (!value) throw new Error("the step returned nothing");
    expect(findAccountDataExportDeliveryProblem(value.delivery)).toBeNull();
    expect(value.delivery.download?.filename).toBe(filename);
    expect(findSignedOutAccountDataExportProblem(value.refusal)).toBeNull();
    // The visitor's own browser closed before the request returned, and the
    // lane's browser kept its sign-in.
    expect(value.contextsAfter).toBe(value.contextsBefore);
    expect(value.laneSignedIn).toBe(true);
  }
);

test.skipIf(!chromiumAvailable)(
  "reports a failed export without waiting for a download",
  async () => {
    const started = Date.now();
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/account/legal?fail=1`);
        return yield* laneBrowser.downloadAccountDataExport(exportPath);
      })
    );

    expect(result.succeeded).toBe(true);
    expect(result.value).toMatchObject({
      controlState: "error",
      download: undefined,
      status: 500,
    });
    expect(
      result.value && findAccountDataExportDeliveryProblem(result.value)
    ).toBe("the export responded with status 500");
    // The download wait lasts as long as a slow export may take, so a
    // failed export must not wait for it.
    expect(Date.now() - started).toBeLessThan(10_000);
  }
);

test.skipIf(!chromiumAvailable)(
  "reads the archive from the download when the browser keeps no copy of the streamed response body",
  async () => {
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/account/legal?streamed=1`);
        return yield* laneBrowser.downloadAccountDataExport(exportPath);
      })
    );

    expect(result.failures).toEqual([]);
    const delivery = result.value;
    if (!delivery) throw new Error("the step returned nothing");
    expect(findAccountDataExportDeliveryProblem(delivery)).toBeNull();
    expect(delivery.download?.archive).toMatchObject({ kind: "readable" });
  }
);

test.skipIf(!chromiumAvailable)(
  "reports an export the control never saved as a missing download",
  async () => {
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/account/legal?unsaved=1`);
        return yield* laneBrowser.downloadAccountDataExport(exportPath);
      })
    );

    expect(result.failures).toEqual([]);
    const delivery = result.value;
    if (!delivery) throw new Error("the step returned nothing");
    expect(delivery).toMatchObject({ download: undefined, status: 200 });
    expect(findAccountDataExportDeliveryProblem(delivery)).toBe(
      "the control started no browser download of the export"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "keeps waiting for the download of an export slower than a UI transition",
  async () => {
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(
          `${origin}/en-US/account/legal?delayMs=${config.timeouts.uiTransition + 500}`
        );
        return yield* laneBrowser.downloadAccountDataExport(exportPath);
      })
    );

    expect(result.failures).toEqual([]);
    expect(
      result.value && findAccountDataExportDeliveryProblem(result.value)
    ).toBeNull();
  }
);

test.skipIf(!chromiumAvailable)(
  "fails the step when the action cannot be clicked, leaving no stray wait",
  async () => {
    const started = Date.now();
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/account/legal?hidden=1`);
        return yield* laneBrowser.downloadAccountDataExport(exportPath);
      })
    );

    expect(result.succeeded).toBe(false);
    expect(result.failures).toEqual([
      {
        message: "download the account data export timed out",
        timeout: true,
      },
    ]);
    expect(Date.now() - started).toBeLessThan(10_000);
  }
);
