import { expect, test } from "bun:test";
import sharp from "sharp";
import { withNextAppFixture } from "@/shared/testing/next-app-fixture.test-utils";

const pngPixel = (gray: number) =>
  sharp({
    create: {
      background: { b: gray, g: gray, r: gray },
      channels: 3,
      height: 1,
      width: 1,
    },
  })
    .png()
    .toBuffer();
// A 2×2 map of 1px tiles at zoom 1 covers the four tiles of the zoom level.
const tilesPerRender = 4;
// Tiles the tile server marks as not reusable, like OpenStreetMap's
// "Access blocked" image.
const uncacheableTiles: Readonly<Record<string, string>> = {
  "1/0/0": "no-cache",
  "1/1/0": "public, no-store",
};

/**
 * Two dynamic routes render the same map from `tileServerUrl`: one with the
 * Workspace map renderer, and one with a plain fetch client as the control.
 */
const mapRoute = (tileServerUrl: string, cached: boolean) => `
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { connection } from "next/server";
import { generateStaticMapImage } from "osm";
import { generateWorkspaceLocationMapImage } from "@/shared/backend/workspace-location-map";

const options = {
  height: 2,
  lat: 0,
  lng: 0,
  tileSize: 1,
  tileUrl: ${JSON.stringify(`${tileServerUrl}${cached ? "cached" : "uncached"}/{z}/{x}/{y}.png`)},
  width: 2,
  zoom: 1,
};

export async function GET() {
  await connection();
  const image = await Effect.runPromise(
    ${
      cached
        ? "generateWorkspaceLocationMapImage(options)"
        : "generateStaticMapImage(options).pipe(Effect.provide(FetchHttpClient.layer))"
    }
  );
  return new Response(new Uint8Array(image), {
    headers: { "content-type": "image/jpeg" },
  });
}
`;

test("reuses downloaded tiles across map renders unless the tile server forbids it", {
  timeout: 180_000,
}, async () => {
  const tileRequests: string[] = [];
  const tileServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      tileRequests.push(path);
      const cacheControl =
        uncacheableTiles[path.replace(/^\/\w+\/|\.png$/g, "")];
      // Uncacheable tiles change with every download, so a reused copy shows
      // up in the rendered map.
      const gray = cacheControl
        ? tileRequests.filter((requested) => requested === path).length * 100
        : 0;
      const headers = new Headers({ "content-type": "image/png" });
      if (cacheControl) headers.set("cache-control", cacheControl);
      return new Response(await pngPixel(gray), { headers });
    },
  });
  try {
    const renders = await withNextAppFixture(
      {
        files: {
          "app/cached/route.ts": mapRoute(tileServer.url.href, true),
          "app/uncached/route.ts": mapRoute(tileServer.url.href, false),
          "next.config.mjs": `
const nextConfig = {
  cacheComponents: true,
  experimental: { externalDir: true },
  transpilePackages: ["osm"],
  // The Workspace typecheck covers these sources.
  typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
`,
        },
        // `next dev` keeps serving a cache entry for a few minutes after it
        // expires, so only a production server shows real cache lifetimes.
        mode: "production",
        name: "workspace-tile-cache",
      },
      async ({ url: fixtureUrl }) => {
        const mapRenders: { image: Buffer; status: number }[] = [];
        for (const route of ["cached", "cached", "uncached", "uncached"]) {
          const response = await fetch(`${fixtureUrl}/${route}`);
          mapRenders.push({
            image: Buffer.from(await response.arrayBuffer()),
            status: response.status,
          });
        }
        return mapRenders;
      }
    );

    const downloads = (path: string) =>
      tileRequests.filter((requested) => requested.startsWith(path)).length;
    expect(renders.map(({ status }) => status)).toEqual([200, 200, 200, 200]);
    // Reusable tiles are downloaded once; tiles marked `no-cache` or
    // `no-store` are downloaded again for the second render.
    expect(downloads("/cached/1/0/1.png")).toBe(1);
    expect(downloads("/cached/1/1/1.png")).toBe(1);
    expect(downloads("/cached/1/0/0.png")).toBe(2);
    expect(downloads("/cached/1/1/0.png")).toBe(2);
    expect(renders[1]?.image).not.toEqual(renders[0]?.image);
    // Without the cached client, every render downloads the tiles again.
    expect(downloads("/uncached/")).toBe(tilesPerRender * 2);
  } finally {
    tileServer.stop(true);
  }
});
