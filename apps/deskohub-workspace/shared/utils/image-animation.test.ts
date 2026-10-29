import { describe, expect, test } from "bun:test";
import { imageFrameCount } from "./image-animation";

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const uint32 = (value: number, littleEndian = false) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, littleEndian);
  return [...bytes];
};

/** A GIF of `frames` 1×1 frames, each after a graphic control extension. */
const gif = (frames: number, { globalColorTable = true } = {}) =>
  new Uint8Array([
    ...ascii("GIF89a"),
    ...[1, 0, 1, 0],
    globalColorTable ? 0x80 : 0,
    0,
    0,
    ...(globalColorTable ? [0, 0, 0, 255, 255, 255] : []),
    // A comment whose bytes look like an image descriptor.
    ...[0x21, 0xfe, 2, 0x2c, 0x2c, 0],
    ...Array.from({ length: frames }, () => [
      ...[0x21, 0xf9, 4, 0, 10, 0, 0, 0],
      ...[0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0],
      ...[2, 2, 0x4c, 0x01, 0],
    ]).flat(),
    0x3b,
  ]);

const pngChunk = (type: string, data: number[]) => [
  ...uint32(data.length),
  ...ascii(type),
  ...data,
  ...uint32(0),
];

const png = (animationFrames?: number) =>
  new Uint8Array([
    ...ascii("\x89PNG\r\n\x1a\n"),
    ...pngChunk(
      "IHDR",
      Array.from({ length: 13 }, () => 0)
    ),
    ...(animationFrames === undefined
      ? []
      : pngChunk("acTL", [...uint32(animationFrames), ...uint32(0)])),
    ...pngChunk("IDAT", [0, 0, 0]),
    ...pngChunk("IEND", []),
  ]);

const riffChunk = (type: string, data: number[]) => [
  ...ascii(type),
  ...uint32(data.length, true),
  ...data,
  ...(data.length % 2 === 1 ? [0] : []),
];

const webp = ({ animated, frames }: { animated: boolean; frames: number }) => {
  const chunks = [
    ...riffChunk("VP8X", [animated ? 0x02 : 0, ...Array(9).fill(0)]),
    ...(animated ? riffChunk("ANIM", [0, 0, 0, 0, 0, 0]) : []),
    ...Array.from({ length: frames }, () =>
      riffChunk("ANMF", [0, 0, 0])
    ).flat(),
  ];
  return new Uint8Array([
    ...ascii("RIFF"),
    ...uint32(4 + chunks.length, true),
    ...ascii("WEBP"),
    ...chunks,
  ]);
};

const isoBox = (type: string, data: number[]) => [
  ...uint32(8 + data.length),
  ...ascii(type),
  ...data,
];

/** An AVIF whose first track lists `samples` frames, after its media data. */
const avif = (brands: string[], samples?: number) => {
  const box = [
    ...ascii("ftyp"),
    ...ascii("avif"),
    ...uint32(0),
    ...brands.flatMap(ascii),
  ];
  const sampleTable =
    samples === undefined
      ? []
      : isoBox("moov", [
          ...isoBox("mvhd", [0, 0, 0, 0]),
          ...isoBox(
            "trak",
            isoBox(
              "mdia",
              isoBox(
                "minf",
                isoBox(
                  "stbl",
                  isoBox("stsz", [
                    ...uint32(0),
                    ...uint32(0),
                    ...uint32(samples),
                  ])
                )
              )
            )
          ),
        ]);
  return new Uint8Array([
    ...uint32(4 + box.length),
    ...box,
    ...isoBox("mdat", [0, 0, 0, 0]),
    ...sampleTable,
  ]);
};

describe("imageFrameCount", () => {
  test("counts every frame of a GIF", () => {
    expect(imageFrameCount(gif(1))).toBe(1);
    expect(imageFrameCount(gif(3))).toBe(3);
    expect(imageFrameCount(gif(2, { globalColorTable: false }))).toBe(2);
  });

  test("reads an APNG's declared frames", () => {
    expect(imageFrameCount(png())).toBe(1);
    expect(imageFrameCount(png(4))).toBe(4);
  });

  test("counts an animated WebP's frames", () => {
    expect(imageFrameCount(webp({ animated: false, frames: 0 }))).toBe(1);
    expect(imageFrameCount(webp({ animated: true, frames: 5 }))).toBe(5);
  });

  test("counts an AVIF sequence's samples", () => {
    expect(imageFrameCount(avif(["mif1", "avif"]))).toBe(1);
    expect(imageFrameCount(avif(["avis", "msf1"], 51))).toBe(51);
  });

  test("counts an AVIF sequence without a sample table as an animation", () => {
    expect(imageFrameCount(avif(["avis", "msf1"]))).toBe(2);
  });

  test("counts a JPEG, a truncated file and unknown bytes as one frame", () => {
    expect(imageFrameCount(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(1);
    expect(imageFrameCount(gif(3).slice(0, 12))).toBe(1);
    expect(imageFrameCount(new Uint8Array())).toBe(1);
  });
});
