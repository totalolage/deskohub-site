import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

// The map's own tests cover rendering; here each render is counted.
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
let renders = 0;
mock.module("@/shared/backend/workspace-location-map", () => ({
  generateWorkspaceLocationMapImage: () =>
    Effect.sync(() => {
      renders += 1;
      return jpegBytes;
    }),
}));

const { GET } = await import("./route");

beforeEach(() => {
  renders = 0;
});

const mapUrl = "https://workspace.example/workspace-location-map.jpeg";

describe("GET /workspace-location-map.jpeg", () => {
  test("renders the map at its canonical URL", async () => {
    const response = await GET(new Request(mapUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(jpegBytes);
    expect(renders).toBe(1);
  });

  test.each(["?v=1", "?cache-bust=1760000000000&width=10", "?"])(
    "redirects %p to the canonical URL without rendering",
    async (query) => {
      const response = await GET(new Request(`${mapUrl}${query}`));

      expect(response.status).toBe(308);
      expect(response.headers.get("Location")).toBe(mapUrl);
      expect(response.headers.get("Cache-Control")).toContain("public");
      expect(renders).toBe(0);
    }
  );
});
