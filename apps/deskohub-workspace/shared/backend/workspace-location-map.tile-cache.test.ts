import { expect, test } from "bun:test";
import { withNextDevFixture } from "@/shared/testing/next-dev-fixture.test-utils";

const pngPixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgyA79DwAC7wHAu6YsjgAAAABJRU5ErkJggg==",
  "base64"
);
// A 2×2 map of 1px tiles at zoom 1 covers the four tiles of the zoom level.
const tilesPerRender = 4;

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

test("reuses downloaded tiles across map renders", {
  timeout: 120_000,
}, async () => {
  const tileRequests: string[] = [];
  const tileServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      tileRequests.push(new URL(request.url).pathname);
      return new Response(pngPixel, {
        headers: { "content-type": "image/png" },
      });
    },
  });
  try {
    const statuses = await withNextDevFixture(
      {
        files: {
          "app/cached/route.ts": mapRoute(tileServer.url.href, true),
          "app/uncached/route.ts": mapRoute(tileServer.url.href, false),
          "next.config.mjs": `
const nextConfig = {
  cacheComponents: true,
  experimental: { externalDir: true },
  transpilePackages: ["osm"],
};
export default nextConfig;
`,
        },
        name: "workspace-tile-cache",
      },
      async ({ url: fixtureUrl }) => {
        const renderStatuses: number[] = [];
        for (const route of ["cached", "cached", "uncached", "uncached"]) {
          const response = await fetch(`${fixtureUrl}/${route}`);
          await response.arrayBuffer();
          renderStatuses.push(response.status);
        }
        return renderStatuses;
      }
    );

    const downloads = (route: string) =>
      tileRequests.filter((path) => path.startsWith(`/${route}/`)).length;
    expect(statuses).toEqual([200, 200, 200, 200]);
    expect(downloads("cached")).toBe(tilesPerRender);
    // Without the cached client, every render downloads the tiles again.
    expect(downloads("uncached")).toBe(tilesPerRender * 2);
  } finally {
    tileServer.stop(true);
  }
});
