import { describe, expect, test } from "bun:test";
import sharpService from "astro/assets/services/sharp";

const imageConfig = {
  service: {
    entrypoint: "astro/assets/services/sharp",
    config: { kernel: "lanczos3", limitInputPixels: 268402689 },
  },
} as Parameters<typeof sharpService.transform>[2];

describe("astro sharp service", () => {
  test("optimizes a truncated warning-level jpeg instead of passing it through unoptimized", async () => {
    const truncated = new Uint8Array(
      await Bun.file(
        new URL("./fixtures/truncated-warning-level.jpg", import.meta.url)
      ).arrayBuffer()
    );
    const result = await sharpService.transform(
      truncated,
      { src: "/fixtures/truncated-warning-level.jpg", format: "jpeg" },
      imageConfig
    );
    expect(result.format).toBe("jpeg");
    expect(Buffer.from(result.data).equals(truncated)).toBe(false);
  });
});
