import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { crc32 } from "node:zlib";
import {
  type IMagickImage,
  ImageMagick,
  initializeImageMagick,
  MagickColor,
  MagickFormat,
  MagickImage,
  MagickImageCollection,
  NoiseType,
  Orientation,
} from "@imagemagick/magick-wasm";
import { Effect, Exit } from "effect";
import type { ImageFit } from "./image-fit";
import { reencodeImageToFit } from "./image-reencoding";

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  await initializeImageMagick(
    readFileSync(require.resolve("@imagemagick/magick-wasm/magick.wasm"))
  );
});

const fit: ImageFit = {
  maxBytes: 60_000,
  maxWidth: 400,
  acceptedTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
};

/** A picture of `width` × `height`, noisy like a photo or flat like a drawing. */
const picture = (
  width: number,
  height: number,
  { noisy = true, color = "#3366aa" } = {}
) => {
  const image = MagickImage.create(new MagickColor(color), width, height);
  if (noisy) image.addNoise(NoiseType.Gaussian);
  return image;
};

const encoded = (
  image: IMagickImage,
  format: MagickFormat,
  name: string,
  type: string
) => {
  const bytes = image.write(format, (data) => data.slice());
  image.dispose();
  return new File([bytes], name, { type });
};

/** A single EXIF entry saying the picture is stored turned a quarter left. */
const rotatedExif = new Uint8Array([
  ...[0x4d, 0x4d, 0, 42, 0, 0, 0, 8],
  ...[0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0],
  ...[0, 0, 0, 0],
]);

/** The 132-byte header of an RGB display profile with no tags. */
const colorProfile = (() => {
  const bytes = new Uint8Array(132);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  view.setUint8(8, 2);
  bytes.set(new TextEncoder().encode("mntrRGB XYZ "), 12);
  bytes.set(new TextEncoder().encode("acsp"), 36);
  return bytes;
})();

interface Shrunk {
  readonly file: File;
  readonly width: number;
  readonly height: number;
  readonly opaque: boolean;
  readonly quality: number;
  readonly hasExif: boolean;
  readonly colorProfile: Uint8Array | undefined;
}

const shrink = async (file: File, imageFit = fit): Promise<Shrunk> => {
  const shrunk = await Effect.runPromise(reencodeImageToFit(file, imageFit));
  const bytes = new Uint8Array(await shrunk.arrayBuffer());
  return ImageMagick.read(bytes, (image) => ({
    file: shrunk,
    width: image.width,
    height: image.height,
    opaque: image.isOpaque,
    quality: image.quality,
    hasExif: image.getProfile("exif") !== null,
    colorProfile: image.getColorProfile()?.data.slice(),
  }));
};

const failure = async (file: File) => {
  const exit = await Effect.runPromiseExit(reencodeImageToFit(file, fit));
  return Exit.isFailure(exit)
    ? exit.cause.reasons.map((reason) =>
        reason._tag === "Fail" ? reason.error._tag : reason._tag
      )
    : [];
};

/** A PNG with an `acTL` chunk declaring two frames, as an APNG has. */
const animatedPng = () => {
  const png = new Uint8Array(
    picture(40, 40).write(MagickFormat.Png, (data) => data.slice())
  );
  const body = new Uint8Array([
    ...new TextEncoder().encode("acTL"),
    ...[0, 0, 0, 2, 0, 0, 0, 0],
  ]);
  const crc = crc32(body);
  const chunk = new Uint8Array([
    ...[0, 0, 0, 8],
    ...body,
    ...[crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff],
  ]);
  // Right after the signature and the 25-byte IHDR chunk.
  const ihdrEnd = 8 + 25;
  return new File(
    [png.slice(0, ihdrEnd), chunk, png.slice(ihdrEnd)],
    "loop.png",
    { type: "image/png" }
  );
};

describe("reencodeImageToFit", () => {
  test("narrows a wide photo to the widest fit, as a JPEG", async () => {
    const shrunk = await shrink(
      encoded(picture(900, 300), MagickFormat.Jpeg, "wide.jpg", "image/jpeg")
    );

    expect(shrunk.file.type).toBe("image/jpeg");
    expect(shrunk.file.name).toBe("wide.jpg");
    expect([shrunk.width, shrunk.height]).toEqual([400, 133]);
    expect(shrunk.file.size).toBeLessThanOrEqual(fit.maxBytes);
  });

  test("turns a photo upright as its EXIF orientation says, and drops the EXIF", async () => {
    const stored = picture(600, 300);
    stored.setProfile("exif", rotatedExif);
    stored.orientation = Orientation.RightTop;

    const shrunk = await shrink(
      encoded(stored, MagickFormat.Jpeg, "phone.jpg", "image/jpeg")
    );

    expect([shrunk.width, shrunk.height]).toEqual([300, 600]);
    expect(shrunk.hasExif).toBe(false);
  });

  test("keeps the picture's colour profile", async () => {
    const stored = picture(900, 300);
    stored.setProfile("icc", colorProfile);

    const shrunk = await shrink(
      encoded(stored, MagickFormat.Jpeg, "wide.jpg", "image/jpeg")
    );

    expect(shrunk.colorProfile).toEqual(colorProfile);
  });

  test("lowers the JPEG quality only as far as the byte limit needs", async () => {
    const file = encoded(
      picture(400, 400),
      MagickFormat.Jpeg,
      "dense.jpg",
      "image/jpeg"
    );
    const loose = await shrink(file, { ...fit, maxBytes: 10_000_000 });
    const tight = await shrink(file);

    expect(loose.quality).toBe(100);
    expect(tight.width).toBe(400);
    expect(tight.file.size).toBeLessThanOrEqual(fit.maxBytes);
    expect(tight.quality).toBeLessThan(100);
  });

  test("narrows a picture that even the lowest quality can't fit", async () => {
    const shrunk = await shrink(
      encoded(
        picture(1000, 1000),
        MagickFormat.Jpeg,
        "dense.jpg",
        "image/jpeg"
      ),
      { ...fit, maxWidth: 1000, maxBytes: 8000 }
    );

    expect(shrunk.width).toBeLessThan(1000);
    expect(shrunk.file.size).toBeLessThanOrEqual(8000);
  });

  test("keeps an opaque drawing a PNG, when that's the smaller file", async () => {
    const shrunk = await shrink(
      encoded(
        picture(800, 400, { noisy: false }),
        MagickFormat.Png,
        "chart.png",
        "image/png"
      )
    );

    expect(shrunk.file.type).toBe("image/png");
    expect(shrunk.file.name).toBe("chart.png");
    expect(shrunk.width).toBe(400);
  });

  test("turns an opaque photo saved as a PNG into a JPEG, when that's the smaller file", async () => {
    const shrunk = await shrink(
      encoded(picture(800, 400), MagickFormat.Png, "photo.png", "image/png")
    );

    expect(shrunk.file.type).toBe("image/jpeg");
    expect(shrunk.width).toBe(400);
  });

  test("keeps a transparent picture a PNG with its transparency", async () => {
    const shrunk = await shrink(
      encoded(
        picture(800, 400, { noisy: false, color: "#3366aa80" }),
        MagickFormat.Png,
        "logo.png",
        "image/png"
      )
    );

    expect(shrunk.file.type).toBe("image/png");
    expect(shrunk.opaque).toBe(false);
    expect(shrunk.width).toBe(400);
  });

  test("converts a still GIF like any other picture", async () => {
    const shrunk = await shrink(
      encoded(
        picture(800, 400, { noisy: false }),
        MagickFormat.Gif,
        "banner.gif",
        "image/gif"
      )
    );

    expect(shrunk.file.type).toBe("image/png");
    expect(shrunk.width).toBe(400);
  });

  test("converts a format the upload doesn't take", async () => {
    const shrunk = await shrink(
      encoded(picture(300, 200), MagickFormat.Bmp, "scan.bmp", "image/bmp")
    );

    expect(shrunk.file.type).toBe("image/jpeg");
    expect(shrunk.file.name).toBe("scan.jpg");
  });

  test("refuses an animated GIF rather than keep only its first frame", async () => {
    const frames = MagickImageCollection.create();
    frames.push(picture(500, 100, { noisy: false, color: "red" }));
    frames.push(picture(500, 100, { noisy: false, color: "blue" }));
    const bytes = frames.write(MagickFormat.Gif, (data) => data.slice());
    frames.dispose();

    expect(
      await failure(new File([bytes], "loop.gif", { type: "image/gif" }))
    ).toEqual(["ImageTooLargeError"]);
  });

  test("refuses an animated PNG, whose frames ImageMagick doesn't count", async () => {
    expect(await failure(animatedPng())).toEqual(["ImageTooLargeError"]);
  });

  test("refuses a file that isn't a picture", async () => {
    expect(
      await failure(
        new File([new TextEncoder().encode("not a picture")], "notes.png", {
          type: "image/png",
        })
      )
    ).toEqual(["ImageDecodeError"]);
  });

  test("refuses a picture that can't fit even at the narrowest width", async () => {
    expect(
      await Effect.runPromiseExit(
        reencodeImageToFit(
          encoded(picture(400, 400), MagickFormat.Png, "x.png", "image/png"),
          { ...fit, maxBytes: 100 }
        )
      ).then((exit) => Exit.isFailure(exit))
    ).toBe(true);
  });
});
