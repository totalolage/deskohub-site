import { describe, expect, test } from "bun:test";
import { downscaledSize } from "./image-downscaling";

const limits = { maxWidth: 1068, maxPixels: 25_000_000 };

describe("downscaledSize", () => {
  test("keeps a picture within both limits", () => {
    expect(downscaledSize({ width: 800, height: 600 }, limits)).toEqual({
      width: 800,
      height: 600,
    });
  });

  test("narrows a wide picture to the widest, keeping its aspect ratio", () => {
    expect(downscaledSize({ width: 4000, height: 3000 }, limits)).toEqual({
      width: 1068,
      height: 801,
    });
  });

  test("shrinks a tall picture to the most pixels", () => {
    const size = downscaledSize({ width: 1000, height: 50_000 }, limits);

    expect(size.width * size.height).toBeLessThanOrEqual(limits.maxPixels);
    expect(size.width / size.height).toBeCloseTo(1000 / 50_000, 3);
  });

  test("never shrinks a side to nothing", () => {
    expect(downscaledSize({ width: 100_000, height: 1 }, limits)).toEqual({
      width: 1068,
      height: 1,
    });
  });
});
