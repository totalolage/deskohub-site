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

setBoardgameTestEnv();
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheTag: (...tags: string[]) => {
    appliedTags.push(...tags);
  },
}));

let generateBlurDataUrlCached: typeof import("./generate-blur-data-url").generateBlurDataUrlCached;

beforeAll(async () => {
  ({ generateBlurDataUrlCached } = await import("./generate-blur-data-url"));
});

const asset = { public_id: "bar/tables/window" } as CloudinaryAsset;

const respondWith = (response: Response) => {
  const requested: string[] = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL | Request
  ) => {
    requested.push(String(input));
    return response;
  }) as typeof fetch);
  return { requested, fetchSpy };
};

let restoreFetch: (() => void) | undefined;

afterEach(() => {
  restoreFetch?.();
  appliedTags.length = 0;
});

describe("generateBlurDataUrlCached", () => {
  test("tags the cache entry with the image and embeds its tiny webp rendition", async () => {
    const { requested, fetchSpy } = respondWith(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      })
    );
    restoreFetch = () => fetchSpy.mockRestore();

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
    const { fetchSpy } = respondWith(response);
    restoreFetch = () => fetchSpy.mockRestore();

    expect(await generateBlurDataUrlCached(asset)).toBe(
      "data:image/webp;base64,AQID"
    );
  });

  test("fails when the tiny rendition cannot be loaded", async () => {
    const { fetchSpy } = respondWith(
      new Response(null, { status: 404, statusText: "Not Found" })
    );
    restoreFetch = () => fetchSpy.mockRestore();

    await expect(generateBlurDataUrlCached(asset)).rejects.toThrow("Not Found");
  });
});
