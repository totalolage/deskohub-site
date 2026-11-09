import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";

const tileHost = "https://tile.openstreetmap.org";
// A tile requested by a plain image, without the map's own referrer policy.
const unconfiguredTileUrl = `${tileHost}/0/0/0.png`;
const pngPixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgyA79DwAC7wHAu6YsjgAAAABJRU5ErkJggg==",
  "base64"
);

type TileRequest = {
  readonly referer: string | undefined;
  readonly url: string;
};

const chromiumAvailable = await playwrightChromiumAvailable();
let buildDirectory = "";
const assets = new Map<string, Blob>();

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(join(tmpdir(), "landing-map-"));
  const build = await Bun.build({
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    entrypoints: [
      join(import.meta.dir, "landing-page-interactive-map.browser-harness.tsx"),
    ],
    format: "iife",
    minify: true,
    naming: "harness.[ext]",
    outdir: buildDirectory,
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  for (const output of build.outputs) {
    assets.set(`/${basename(output.path)}`, output);
  }
});

afterAll(async () => {
  if (buildDirectory) {
    await rm(buildDirectory, { force: true, recursive: true });
  }
});

/**
 * Serves the harness under the site-wide `Referrer-Policy: no-referrer` that
 * next.config.mjs sends with every page.
 */
const serveSite = () =>
  Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      const asset = assets.get(pathname);
      if (asset) return new Response(asset);
      if (pathname !== "/cs-CZ" && pathname !== "/cs-CZ/gallery") {
        return new Response("", { status: 404 });
      }
      return new Response(
        `<!doctype html><html><head><link rel="stylesheet" href="/harness.css"></head><body><a id="home-link" href="/cs-CZ">Home</a><img alt="" src="${unconfiguredTileUrl}"><div id="root" style="width:800px;height:480px"></div><script src="/harness.js"></script></body></html>`,
        {
          headers: {
            "content-type": "text/html",
            "referrer-policy": "no-referrer",
          },
        }
      );
    },
  });

/**
 * Opens `startPath`, runs `showMap`, and returns every tile request the page
 * made once the map has loaded tiles. Tile requests are answered locally, and
 * any other request leaving the test server is aborted.
 */
const collectTileRequests = async (
  startPath: string,
  showMap: (page: Page) => Promise<void>
) => {
  const server = serveSite();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const tileRequests: TileRequest[] = [];
    await context.route(
      (url) => url.origin !== server.url.origin,
      (route) => route.abort()
    );
    await context.route(`${tileHost}/**`, async (route) => {
      const request = route.request();
      tileRequests.push({
        referer: (await request.allHeaders()).referer,
        url: request.url(),
      });
      await route.fulfill({ body: pngPixel, contentType: "image/png" });
    });
    const page = await context.newPage();
    await page.goto(new URL(startPath, server.url).href);
    await showMap(page);
    await page.locator("img.leaflet-tile-loaded").first().waitFor();
    return { origin: server.url.origin, tileRequests };
  } finally {
    await browser.close();
    server.stop(true);
  }
};

const expectOriginRefererOnMapTiles = ({
  origin,
  tileRequests,
}: {
  readonly origin: string;
  readonly tileRequests: readonly TileRequest[];
}) => {
  const unconfigured = tileRequests.filter(
    ({ url }) => url === unconfiguredTileUrl
  );
  const mapTiles = tileRequests.filter(
    ({ url }) => url !== unconfiguredTileUrl
  );

  // The page policy strips the Referer from tiles the map does not configure.
  expect(unconfigured).toEqual([
    { referer: undefined, url: unconfiguredTileUrl },
  ]);
  expect(mapTiles.length).toBeGreaterThan(0);
  expect(new Set(mapTiles.map(({ referer }) => referer))).toEqual(
    new Set([`${origin}/`])
  );
};

test.skipIf(!chromiumAvailable)(
  "sends the site origin as Referer with map tiles on a direct load of a no-referrer page",
  async () => {
    expectOriginRefererOnMapTiles(
      await collectTileRequests("/cs-CZ", async () => {})
    );
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "sends the site origin as Referer with map tiles after client-side navigation",
  async () => {
    expectOriginRefererOnMapTiles(
      await collectTileRequests("/cs-CZ/gallery", async (page) => {
        await page.locator("#home-link").click();
      })
    );
  },
  60_000
);
