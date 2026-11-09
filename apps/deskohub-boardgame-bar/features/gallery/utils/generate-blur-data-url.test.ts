import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

let generateBlurDataUrl: typeof import("./generate-blur-data-url").generateBlurDataUrl;

beforeAll(async () => {
  setBoardgameTestEnv();
  ({ generateBlurDataUrl } = await import("./generate-blur-data-url"));
});

const asset = { public_id: "bar/games/catan" } as CloudinaryAsset;

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
  restoreFetch = undefined;
});

describe("generateBlurDataUrl", () => {
  test("embeds the image's 10-pixel webp rendition with the response's content type", async () => {
    const requested = respondWith(
      new Response(new Uint8Array([255, 0, 128]), {
        headers: { "content-type": "image/jpeg" },
      })
    );

    expect(await generateBlurDataUrl(asset)).toBe(
      "data:image/jpeg;base64,/wCA"
    );
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

    expect(await generateBlurDataUrl(asset)).toBe(
      "data:image/webp;base64,AQID"
    );
  });

  test("fails with the response status when the rendition cannot be loaded", async () => {
    respondWith(
      new Response(null, { status: 503, statusText: "Service Unavailable" })
    );

    await expect(generateBlurDataUrl(asset)).rejects.toThrow(
      "Service Unavailable"
    );
  });
});
