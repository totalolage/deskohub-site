import { describe, expect, test } from "bun:test";
import { isTransparent } from "./image-transparency";

const rgba = (...pixels: ReadonlyArray<readonly number[]>) =>
  new Uint8ClampedArray(pixels.flat());

describe("isTransparent", () => {
  test("finds no transparency in no pixels", () => {
    expect(isTransparent(new Uint8ClampedArray())).toBe(false);
  });

  test("treats fully opaque pixels as opaque, whatever their colour", () => {
    expect(isTransparent(rgba([0, 0, 0, 255], [255, 255, 255, 255]))).toBe(
      false
    );
  });

  test("finds a partly transparent pixel after opaque ones", () => {
    expect(isTransparent(rgba([0, 0, 0, 255], [10, 20, 30, 254]))).toBe(true);
  });

  test("finds a fully transparent pixel", () => {
    expect(isTransparent(rgba([255, 255, 255, 0]))).toBe(true);
  });

  test("reads only the alpha channel", () => {
    expect(isTransparent(rgba([0, 0, 0, 255], [1, 2, 3, 255]))).toBe(false);
  });
});
