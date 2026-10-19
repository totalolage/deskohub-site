import "server-only";

import { join } from "node:path";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { cacheLife } from "next/cache";
import { generateStaticMapImage, type StaticMapImageOptions } from "osm";
import { isReusableBySharedCache } from "@/shared/utils/response-cacheability";
import { workspaceLocationMapImageOptions } from "@/shared/utils/workspace-location-map";

// The OpenStreetMap tile usage policy asks clients to keep parallel tile
// downloads low; one map render needs dozens of tiles.
export const workspaceLocationMapTileConcurrency = 4;

// The policy also asks for downloaded tiles to be cached for at least seven
// days, following the tile server's HTTP headers.
const tileCacheLife = {
  stale: 7 * 24 * 60 * 60,
  revalidate: 7 * 24 * 60 * 60,
  expire: 7 * 24 * 60 * 60,
} as const;

// A failed download or a response that forbids reuse, such as the
// "Access blocked" image OpenStreetMap serves with `Cache-Control: no-cache`,
// is downloaded again on the next render.
const uncachedTileLife = { stale: 0, revalidate: 0, expire: 0 } as const;

// The cached download outlives the render that started it, which cannot pass
// its abort signal into a cache entry, so the download ends itself within the
// renderer's per-tile timeout.
const tileDownloadTimeoutMs = 10_000;

type DownloadedTile = {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
};

async function downloadTile(
  url: string,
  headers: Readonly<Record<string, string>>
): Promise<DownloadedTile> {
  // Shared across server instances, so a render after a CDN miss reuses the
  // tiles.
  "use cache: remote";
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(tileDownloadTimeoutMs),
  });
  cacheLife(
    isReusableBySharedCache(response) ? tileCacheLife : uncachedTileLife
  );
  return {
    body: new Uint8Array(await response.arrayBuffer()),
    headers: Object.fromEntries(response.headers),
    status: response.status,
  };
}

const fetchThroughTileCache: typeof globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const tile = await downloadTile(
      request.url,
      Object.fromEntries(request.headers)
    );
    return new Response(Buffer.from(tile.body), {
      headers: tile.headers,
      status: tile.status,
    });
  },
  {
    preconnect: (...args: Parameters<typeof globalThis.fetch.preconnect>) =>
      globalThis.fetch.preconnect(...args),
  }
);

// Vercel functions have no system fonts, so the map attribution brings its own.
const attributionFont = {
  file: join(process.cwd(), "assets", "fonts", "Geist", "regular.ttf"),
  family: "Geist",
};

export const generateWorkspaceLocationMapImage = (
  options: StaticMapImageOptions = workspaceLocationMapImageOptions
) =>
  generateStaticMapImage({ attributionFont, ...options }).pipe(
    Effect.withConcurrency(workspaceLocationMapTileConcurrency),
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetchThroughTileCache)
  );
