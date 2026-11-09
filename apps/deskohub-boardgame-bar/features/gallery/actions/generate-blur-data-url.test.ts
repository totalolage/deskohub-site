import {
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

const appliedTags: string[] = [];

let generateBlurDataUrlCached: typeof import("./generate-blur-data-url").generateBlurDataUrlCached;

beforeAll(async () => {
  setBoardgameTestEnv();
  const nextCache = await import("next/cache");
  mock.module("next/cache", () => ({
    ...nextCache,
    cacheTag: (...tags: string[]) => {
      appliedTags.push(...tags);
    },
  }));
  ({ generateBlurDataUrlCached } = await import("./generate-blur-data-url"));
});

const asset = { public_id: "bar/tables/window" } as CloudinaryAsset;

let restoreFetch: (() => void) | undefined;

/** Answers every fetch with `response` and records the requested URLs. */
const respondWith = (response: Response) => {
  const requested: string[] = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL | Request
  ) => {
    requested.push(String(input));
    return response;
  }) as typeof fetch);
  restoreFetch = () => fetchSpy.mockRestore();
  return requested;
};

afterEach(() => {
  restoreFetch?.();
  appliedTags.length = 0;
});

describe("generateBlurDataUrlCached", () => {
  test("tags the cache entry with the image and embeds its tiny webp rendition", async () => {
    const requested = respondWith(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      })
    );

    expect(await generateBlurDataUrlCached(asset)).toBe(
      "data:image/png;base64,AQID"
    );
    expect(appliedTags).toEqual(cloudinaryTags.getTags(asset.public_id));
    expect(requested).toHaveLength(1);
    const url = new URL(requested[0]!);
    expect(url.pathname).toEndWith(`/${asset.public_id}`);
    expect(url.pathname).toContain("w_10");
    expect(url.pathname).toContain("f_webp");
  });

  test("labels the image as webp when the response has no content type", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]));
    response.headers.delete("content-type");
    respondWith(response);

    expect(await generateBlurDataUrlCached(asset)).toBe(
      "data:image/webp;base64,AQID"
    );
  });

  test("fails when the tiny rendition cannot be loaded", async () => {
    respondWith(new Response(null, { status: 404, statusText: "Not Found" }));

    await expect(generateBlurDataUrlCached(asset)).rejects.toThrow("Not Found");
  });
});
