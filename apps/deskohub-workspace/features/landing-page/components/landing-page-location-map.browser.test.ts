import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";

const tileHost = "https://tile.openstreetmap.org";
const pngPixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgyA79DwAC7wHAu6YsjgAAAABJRU5ErkJggg==",
  "base64"
);
const entryScript = "/harness.js";
// The harness renders the map with this button label.
const activateLabel = "Activate map";

const chromiumAvailable = await playwrightChromiumAvailable();
let buildDirectory = "";
let browser: Browser | undefined;
const assets = new Map<string, Blob>();
// The chunks that carry Leaflet, which only the interactive map imports.
const interactiveMapChunks = new Set<string>();

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "landing-location-map-"));
  // Split like the production bundle, so the interactive map is its own chunk.
  const build = await Bun.build({
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    entrypoints: [
      join(import.meta.dir, "landing-page-location-map.browser-harness.tsx"),
    ],
    format: "esm",
    minify: true,
    naming: { entry: "harness.[ext]", chunk: "[name]-[hash].[ext]" },
    outdir: buildDirectory,
    splitting: true,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  for (const output of build.outputs) {
    const path = `/${basename(output.path)}`;
    assets.set(path, output);
    if (
      path.endsWith(".js") &&
      (await output.text()).includes("leaflet-container")
    ) {
      interactiveMapChunks.add(path);
    }
  }
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory) {
    await rm(buildDirectory, { force: true, recursive: true });
  }
});

const serveSite = () =>
  Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      const asset = assets.get(pathname);
      if (asset) return new Response(asset);
      if (pathname.startsWith("/workspace-location-map/")) {
        return new Response(pngPixel, {
          headers: { "content-type": "image/png" },
        });
      }
      if (pathname !== "/") return new Response("", { status: 404 });
      const styles = [...assets.keys()]
        .filter((path) => path.endsWith(".css"))
        .map((path) => `<link rel="stylesheet" href="${path}">`)
        .join("");
      return new Response(
        `<!doctype html><html><head>${styles}</head><body><div id="root" style="position:relative;width:800px;height:480px"></div><script type="module" src="${entryScript}"></script></body></html>`,
        { headers: { "content-type": "text/html" } }
      );
    },
  });

/**
 * Opens the static map and hands `inspect` the page with a log of the scripts
 * and tiles it requested. Tiles are answered locally; anything else leaving
 * the test server is aborted.
 */
const withLocationMap = async (
  inspect: (
    page: Page,
    requests: { readonly scripts: string[]; readonly tiles: string[] }
  ) => Promise<void>
) => {
  const server = serveSite();
  const context = await browser!.newContext();
  try {
    const requests = { scripts: [] as string[], tiles: [] as string[] };
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === server.url.origin && url.pathname.endsWith(".js")) {
        requests.scripts.push(url.pathname);
      }
    });
    await context.route(
      (url) => url.origin !== server.url.origin,
      (route) => route.abort()
    );
    await context.route(`${tileHost}/**`, async (route) => {
      requests.tiles.push(route.request().url());
      await route.fulfill({ body: pngPixel, contentType: "image/png" });
    });
    const page = await context.newPage();
    await page.goto(server.url.href);
    await page.locator("picture img").waitFor({ state: "attached" });
    await page.waitForLoadState("networkidle");
    await inspect(page, requests);
  } finally {
    await context.close();
    server.stop(true);
  }
};
const requestedMapChunks = (scripts: readonly string[]) =>
  scripts.filter((path) => interactiveMapChunks.has(path));

test.skipIf(!chromiumAvailable)(
  "shows the static map without the interactive map's code or tiles",
  async () => {
    expect(interactiveMapChunks.size).toBeGreaterThan(0);
    await withLocationMap(async (page, requests) => {
      expect(requests.scripts).toContain(entryScript);
      expect(requestedMapChunks(requests.scripts)).toEqual([]);
      expect(requests.tiles).toEqual([]);
      expect(await page.locator(".leaflet-container").count()).toBe(0);
    });
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fetches the interactive map's code, but no tiles, when pointed at",
  async () => {
    await withLocationMap(async (page, requests) => {
      await page.getByRole("button", { name: activateLabel }).hover();
      await page.waitForLoadState("networkidle");

      expect(requestedMapChunks(requests.scripts)).not.toEqual([]);
      expect(requests.tiles).toEqual([]);
      expect(await page.locator(".leaflet-container").count()).toBe(0);
    });
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "swaps in the interactive map once a visitor asks for it",
  async () => {
    await withLocationMap(async (page, requests) => {
      await page.getByRole("button", { name: activateLabel }).click();
      await page.locator("img.leaflet-tile-loaded").first().waitFor();
      await page.locator("picture").waitFor({ state: "detached" });

      expect(requests.tiles.length).toBeGreaterThan(0);
      expect(
        await page.getByRole("button", { name: activateLabel }).count()
      ).toBe(0);
    });
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "keeps the static map when a tile fails, until the visitor moves the map",
  async () => {
    await withLocationMap(async (page) => {
      await page.context().unroute(`${tileHost}/**`);
      await page.context().route(`${tileHost}/**`, (route) => route.abort());
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() =>
        document.activeElement?.classList.contains("leaflet-container")
      );
      await page.waitForLoadState("networkidle");

      expect(await page.locator("picture").count()).toBe(1);

      // The static map no longer matches a moved view.
      await page.keyboard.press("Equal");
      await page.locator("picture").waitFor({ state: "detached" });
    });
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "moves keyboard focus into the map it opened",
  async () => {
    await withLocationMap(async (page) => {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");

      await page.waitForFunction(() =>
        document.activeElement?.classList.contains("leaflet-container")
      );
    });
  },
  60_000
);
