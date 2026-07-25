import { describe, expect, test } from "bun:test";
import { Effect, Layer, Predicate } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/unstable/http";
import sharp from "sharp";
import { generateStaticMapImage, generateSvgPngBuffer } from "./index";

const pngPixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgyA79DwAC7wHAu6YsjgAAAABJRU5ErkJggg==",
  "base64"
);

const staticMapOptions = {
  lat: 0,
  lng: 0,
  zoom: 0,
  width: 1,
  height: 1,
  tileSize: 1,
  tileUrl: "https://tiles.example.test/{z}/{x}/{y}.png",
  userAgent: "OSM Effect test",
} as const;

const runWithFetch = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  fetch: typeof globalThis.fetch
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
        )
      )
    )
  );

const makeFetch = (
  handler: (
    ...args: Parameters<typeof globalThis.fetch>
  ) => ReturnType<typeof globalThis.fetch>
): typeof globalThis.fetch =>
  Object.assign(handler, { preconnect: globalThis.fetch.preconnect });

describe("generateStaticMapImage", () => {
  test("uses the Effect HTTP client and renders a JPEG", async () => {
    const requests: Request[] = [];
    const fetch = makeFetch(async (input, init) => {
      requests.push(
        input instanceof Request ? input : new Request(input, init)
      );

      return new Response(pngPixel, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });

    const image = await runWithFetch(
      generateStaticMapImage(staticMapOptions),
      fetch
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://tiles.example.test/0/0/0.png");
    expect(requests[0]?.headers.get("User-Agent")).toBe("OSM Effect test");
    expect(image.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    await expect(sharp(image).metadata()).resolves.toMatchObject({
      format: "jpeg",
      width: 1,
      height: 1,
    });
  });

  test("reports non-successful tile responses as typed failures", async () => {
    const fetch = makeFetch(async () => new Response(null, { status: 429 }));

    const error = await runWithFetch(
      generateStaticMapImage(staticMapOptions).pipe(Effect.flip),
      fetch
    );

    expect(Predicate.isTagged(error, "OsmTileRequestError")).toBe(true);
    if (!Predicate.isTagged(error, "OsmTileRequestError")) return;

    expect(error).toMatchObject({
      statusCode: 429,
      url: "https://tiles.example.test/0/0/0.png",
      x: 0,
      y: 0,
      z: 0,
    });
  });

  test("preserves transport failures in the typed error cause", async () => {
    const transportFailure = new Error("network unavailable");
    const fetch = makeFetch(async () => {
      throw transportFailure;
    });

    const error = await runWithFetch(
      generateStaticMapImage(staticMapOptions).pipe(Effect.flip),
      fetch
    );

    expect(Predicate.isTagged(error, "OsmTileRequestError")).toBe(true);
    if (!Predicate.isTagged(error, "OsmTileRequestError")) return;

    expect(error.cause).toBeDefined();
    expect(error.message).toContain("could not be downloaded");
  });
});

describe("generateSvgPngBuffer", () => {
  test("renders SVG input as a PNG Effect", async () => {
    const image = await Effect.runPromise(
      generateSvgPngBuffer(
        '<svg width="2" height="3" xmlns="http://www.w3.org/2000/svg"><rect width="2" height="3" fill="#006b55"/></svg>'
      )
    );

    expect(image.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    await expect(sharp(image).metadata()).resolves.toMatchObject({
      format: "png",
      width: 2,
      height: 3,
    });
  });

  test("reports native rendering failures through the typed error channel", async () => {
    const error = await Effect.runPromise(
      generateSvgPngBuffer("<not-svg>").pipe(Effect.flip)
    );

    expect(error).toMatchObject({
      _tag: "ImageRenderingError",
      operation: "render-svg",
    });
    expect(error.cause).toBeDefined();
  });
});
