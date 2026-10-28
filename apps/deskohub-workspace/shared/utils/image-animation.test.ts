import { describe, expect, test } from "bun:test";
import { isAnimatedPngOrAvif } from "./image-animation";

const text = (value: string) => [...new TextEncoder().encode(value)];
const uint32 = (value: number) => [
  value >>> 24,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

/** A PNG's signature and chunks, with zeroed checksums; only structure counts. */
const png = (
  ...chunks: ReadonlyArray<readonly [string, ReadonlyArray<number>]>
) =>
  new Uint8Array([
    ...[0x89, ...text("PNG\r\n"), 0x1a, 0x0a],
    ...chunks.flatMap(([type, data]) => [
      ...uint32(data.length),
      ...text(type),
      ...data,
      ...uint32(0),
    ]),
  ]);

const header = ["IHDR", new Array(13).fill(0)] as const;
const animationControl = (frames: number) =>
  ["acTL", [...uint32(frames), ...uint32(0)]] as const;
const imageData = ["IDAT", [0]] as const;

/** An AVIF file's leading `ftyp` box with these brands. */
const avif = (major: string, ...compatible: string[]) =>
  new Uint8Array([
    ...uint32(16 + 4 * compatible.length),
    ...text("ftyp"),
    ...text(major),
    ...uint32(0),
    ...compatible.flatMap(text),
  ]);

describe("isAnimatedPngOrAvif", () => {
  test.each([
    ["an APNG", png(header, animationControl(2), imageData), true],
    [
      "an APNG of one frame",
      png(header, animationControl(1), imageData),
      false,
    ],
    ["a still PNG", png(header, imageData), false],
    ["an AVIF sequence", avif("avis", "avif", "msf1"), true],
    ["an AVIF sequence listed as compatible", avif("avif", "avis"), true],
    ["a still AVIF", avif("avif", "mif1"), false],
    [
      "a GIF, which ImageMagick counts itself",
      new Uint8Array(text("GIF89a")),
      false,
    ],
    ["bytes of no format", new Uint8Array([1, 2, 3]), false],
  ])("tells %s", (_name, bytes, animated) => {
    expect(isAnimatedPngOrAvif(bytes)).toBe(animated);
  });
});
