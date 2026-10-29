import "@/shared/testing/workspace-test-env";

import { beforeEach, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";

const nextCache = recordNextCache();
let renderFailure: Error | undefined;

mock.module("next/cache", () => nextCache.module);
// Keep the real renderer before the mock replaces the module's bindings.
const osm = { ...(await import("osm")) };
const renderSvgPng = osm.generateSvgPngBuffer;
mock.module("osm", () => ({
  ...osm,
  generateSvgPngBuffer: (...args: Parameters<typeof renderSvgPng>) =>
    renderFailure ? Effect.die(renderFailure) : renderSvgPng(...args),
}));

const { GET } = await import("./route");

beforeEach(() => {
  nextCache.clear();
  renderFailure = undefined;
});

test("serves the favicon as a PNG shared for the longest lifetime", async () => {
  const response = await GET();
  const image = new Uint8Array(await response.arrayBuffer());

  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect([...image.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  expect(nextCache.calls).toEqual([{ cacheLife: "max" }]);
});

test("rejects a favicon that fails to render, unshared", async () => {
  renderFailure = new Error("synthetic render failure");

  await expect(GET()).rejects.toBe(renderFailure);
  expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
});
