import { Data, Effect } from "effect";
import type { ImageSize } from "./image-size";

/** The browser can't decode the file as a picture. */
export class ImageDecodeError extends Data.TaggedError("ImageDecodeError") {}

/** How large a downscaled picture may be. */
export interface ImageDownscaleLimits {
  /** The widest picture, in pixels. */
  readonly maxWidth: number;
  /** The most pixels in the picture. */
  readonly maxPixels: number;
  /** The largest encoded file, in bytes. */
  readonly maxBytes: number;
}

/** JPEG quality of a downscaled opaque picture: no visible loss. */
const jpegQuality = 0.92;

/**
 * Smaller re-encodings to try when one is still too heavy. Each scales the
 * picture by the share of bytes it may keep, with room to spare.
 */
const extraEncodings = 3;
const byteBudgetMargin = 0.9;

/**
 * The size `size` is scaled down to, keeping its aspect ratio, so it's at
 * most `maxWidth` wide and has at most `maxPixels` pixels. A picture already
 * within both keeps its size.
 */
export const downscaledSize = (
  size: ImageSize,
  { maxWidth, maxPixels }: Pick<ImageDownscaleLimits, "maxWidth" | "maxPixels">
): ImageSize => {
  const scale = Math.min(
    1,
    maxWidth / size.width,
    Math.sqrt(maxPixels / (size.width * size.height))
  );
  return {
    width: Math.max(1, Math.floor(size.width * scale)),
    height: Math.max(1, Math.floor(size.height * scale)),
  };
};

const scaledBy = (size: ImageSize, scale: number): ImageSize => ({
  width: Math.max(1, Math.floor(size.width * scale)),
  height: Math.max(1, Math.floor(size.height * scale)),
});

const isTransparent = (pixels: Uint8ClampedArray) => {
  for (let alpha = 3; alpha < pixels.length; alpha += 4) {
    if (pixels[alpha] !== 255) return true;
  }
  return false;
};

/**
 * Draws the picture at `size` and encodes it: as a PNG when any pixel is
 * transparent, so it keeps its alpha, and otherwise as a JPEG.
 */
const encode = (picture: ImageBitmap, size: ImageSize) =>
  Effect.suspend(() => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) return Effect.die(new Error("No 2D canvas context."));
    context.imageSmoothingQuality = "high";
    context.drawImage(picture, 0, 0, size.width, size.height);
    const { data } = context.getImageData(0, 0, size.width, size.height);
    const type = isTransparent(data) ? "image/png" : "image/jpeg";
    return Effect.promise(() =>
      canvas.convertToBlob({ type, quality: jpegQuality })
    );
  });

const encodeWithin = (
  picture: ImageBitmap,
  size: ImageSize,
  maxBytes: number,
  encodingsLeft: number
): Effect.Effect<Blob> =>
  encode(picture, size).pipe(
    Effect.flatMap((file) =>
      file.size <= maxBytes || encodingsLeft === 0
        ? Effect.succeed(file)
        : encodeWithin(
            picture,
            scaledBy(
              size,
              Math.sqrt((maxBytes / file.size) * byteBudgetMargin)
            ),
            maxBytes,
            encodingsLeft - 1
          )
    )
  );

/**
 * Re-encodes the file's picture, upright and without its metadata, within
 * `limits`, on a canvas: no WebAssembly codec needed. A transparent picture
 * becomes a PNG and any other a JPEG; an animation keeps its first frame.
 * A picture still too heavy at its size is scaled down further, a few times
 * at most.
 */
export const downscaleImage = (
  file: Blob,
  limits: ImageDownscaleLimits
): Effect.Effect<Blob, ImageDecodeError> =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => createImageBitmap(file, { imageOrientation: "from-image" }),
      catch: () => new ImageDecodeError(),
    }),
    (picture) =>
      encodeWithin(
        picture,
        downscaledSize(picture, limits),
        limits.maxBytes,
        extraEncodings
      ),
    (picture) => Effect.sync(() => picture.close())
  );
