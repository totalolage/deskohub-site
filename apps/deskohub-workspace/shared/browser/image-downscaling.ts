import { Data, Effect, Option } from "effect";
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
 * A re-encoding still too heavy is scaled by the share of bytes it may keep,
 * with room to spare.
 */
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

const drawingContext = (canvas: OffscreenCanvas) =>
  Effect.sync(() => canvas.getContext("2d")).pipe(
    Effect.flatMap(Effect.fromNullishOr),
    Effect.orDie
  );

/**
 * Draws the picture at `size` and encodes it: as a PNG when any pixel is
 * transparent, so it keeps its alpha, and otherwise as a JPEG.
 */
const encode = ({
  picture,
  size,
}: {
  readonly picture: ImageBitmap;
  readonly size: ImageSize;
}) =>
  Effect.Do.pipe(
    Effect.let("canvas", () => new OffscreenCanvas(size.width, size.height)),
    Effect.bind("context", ({ canvas }) => drawingContext(canvas)),
    Effect.bind("type", ({ context }) =>
      Effect.sync(() => {
        context.imageSmoothingQuality = "high";
        context.drawImage(picture, 0, 0, size.width, size.height);
        const { data } = context.getImageData(0, 0, size.width, size.height);
        return isTransparent(data) ? "image/png" : "image/jpeg";
      })
    ),
    Effect.flatMap(({ canvas, type }) =>
      Effect.promise(() => canvas.convertToBlob({ type, quality: jpegQuality }))
    )
  );

/**
 * Encodes the picture at `size`, then smaller until the file fits
 * `maxBytes`. A 1-pixel picture fits any real limit, so this ends.
 */
const encodeWithin = (input: {
  readonly picture: ImageBitmap;
  readonly size: ImageSize;
  readonly maxBytes: number;
}): Effect.Effect<Blob> =>
  encode(input).pipe(
    Effect.flatMap((file) =>
      Effect.suspend(() =>
        encodeWithin({
          ...input,
          size: scaledBy(
            input.size,
            Math.sqrt((input.maxBytes / file.size) * byteBudgetMargin)
          ),
        })
      ).pipe(
        Effect.when(
          Effect.succeed(
            file.size > input.maxBytes &&
              input.size.width * input.size.height > 1
          )
        ),
        Effect.map(Option.getOrElse(() => file))
      )
    )
  );

/**
 * Re-encodes the file's picture, upright and without its metadata, within
 * `limits`, on a canvas: no WebAssembly codec needed. A transparent picture
 * becomes a PNG and any other a JPEG; an animation keeps its first frame.
 * A picture still too heavy at its size is scaled down further until it fits.
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
      encodeWithin({
        picture,
        size: downscaledSize(picture, limits),
        maxBytes: limits.maxBytes,
      }),
    (picture) => Effect.sync(() => picture.close())
  );
