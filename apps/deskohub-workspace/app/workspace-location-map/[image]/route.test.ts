import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import type { StaticMapImageOptions } from "osm";

// The map's own tests cover rendering; here each render is recorded.
const webpBytes = Buffer.from("RIFF0000WEBP");
let renders: Array<StaticMapImageOptions | undefined> = [];
mock.module("@/shared/backend/workspace-location-map", () => ({
  generateWorkspaceLocationMapImage: (options?: StaticMapImageOptions) =>
    Effect.sync(() => {
      renders.push(options);
      return webpBytes;
    }),
}));

const { GET } = await import("./route");

beforeEach(() => {
  renders = [];
});

const origin = "https://workspace.example";
const get = (path: string) =>
  GET(new Request(`${origin}${path}`), {
    params: Promise.resolve({
      image: new URL(path, origin).pathname.split("/").at(-1)!,
    }),
  });

describe("GET /workspace-location-map/[image]", () => {
  test.each(["compact", "medium", "wide", "extra-wide"])(
    "renders the %s framing as WebP for the page to annotate",
    async (framing) => {
      const response = await get(`/workspace-location-map/${framing}.webp`);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/webp");
      expect(response.headers.get("Cache-Control")).toContain("public");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(webpBytes);
      expect(renders).toEqual([
        expect.objectContaining({
          attribution: false,
          format: "webp",
          marker: false,
        }),
      ]);
    }
  );

  test.each([
    "/workspace-location-map/wide.webp?v=1",
    "/workspace-location-map/compact.webp?",
  ])("redirects %p to the canonical URL without rendering", async (path) => {
    const response = await get(path);

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(
      `${origin}${new URL(path, origin).pathname}`
    );
    expect(renders).toEqual([]);
  });

  test.each([
    "/workspace-location-map/huge.webp",
    "/workspace-location-map/wide.jpeg",
    "/workspace-location-map/constructor.webp",
  ])("finds no map at %p", async (path) => {
    const response = await get(path);

    expect(response.status).toBe(404);
    expect(renders).toEqual([]);
  });
});
