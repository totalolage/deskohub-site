import {
  type IMagickImage,
  MagickFormat,
  MagickImage,
  MagickImageCollection,
} from "@imagemagick/magick-wasm";
import { Effect } from "effect";
import { isAnimatedPngOrAvif } from "@/shared/utils/image-animation";
import { clamp } from "@/shared/utils/number";
import {
  ImageDecodeError,
  type ImageFit,
  ImageTooLargeError,
} from "./image-fit";

/** Narrower than this, an image is too small to be worth sending. */
const minWidth = 256;

/** Formats whose pictures are usually drawings, which PNG keeps lossless. */
const losslessTypes: ReadonlyArray<string> = ["image/png", "image/gif"];

type EncodedType = "image/jpeg" | "image/png";

interface EncodedImage {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly type: EncodedType;
}

/**
 * Re-encodes the image with ImageMagick so it fits: turned upright as its
 * EXIF orientation says, at most `fit.maxWidth` wide, and within
 * `fit.maxBytes`. A picture with transparency becomes a lossless PNG. An
 * opaque PNG or GIF becomes whichever of a PNG and a JPEG is smaller; any
 * other opaque picture becomes a JPEG. A JPEG is written at the highest
 * quality that fits, which ImageMagick finds itself (`jpeg:extent`). Only
 * when even that is too large does the picture get narrower. An animation
 * isn't re-encoded, since only its first frame would survive.
 *
 * Needs ImageMagick initialized, as the shrinking worker does.
 */
export const reencodeImageToFit = Effect.fn("reencodeImageToFit")(function* (
  file: File,
  fit: ImageFit
) {
  const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
  if (isAnimatedPngOrAvif(bytes) || (yield* frameCount(bytes)) > 1) {
    return yield* new ImageTooLargeError();
  }
  const encoded = yield* Effect.acquireUseRelease(
    Effect.sync(() => MagickImage.create()),
    (picture) =>
      readUpright(picture, bytes).pipe(
        Effect.andThen(() =>
          encodeToFit(
            picture,
            fit,
            Math.min(picture.width, fit.maxWidth),
            candidateTypes(picture, file.type)
          )
        )
      ),
    (picture) => Effect.sync(() => picture.dispose())
  );
  return new File([encoded.bytes], fileName(file.name, encoded.type), {
    type: encoded.type,
    lastModified: file.lastModified,
  });
});

/**
 * The frames ImageMagick finds, read from the file's structure without
 * decoding a pixel. It sees every frame of a GIF or WebP, but only the first
 * of an APNG or AVIF sequence.
 */
const frameCount = (bytes: Uint8Array) =>
  Effect.acquireUseRelease(
    Effect.sync(() => MagickImageCollection.create()),
    (frames) =>
      Effect.try({
        try: () => {
          frames.ping(bytes);
          return frames.length;
        },
        catch: () => new ImageDecodeError(),
      }),
    (frames) => Effect.sync(() => frames.dispose())
  );

/**
 * Decodes the picture, turns it upright and drops its metadata, such as
 * where a photo was taken, keeping only the colour profile its colours need.
 */
const readUpright = (picture: IMagickImage, bytes: Uint8Array) =>
  Effect.try({
    try: () => picture.read(bytes),
    catch: () => new ImageDecodeError(),
  }).pipe(
    Effect.andThen(() =>
      Effect.sync(() => {
        picture.autoOrient();
        const colorProfile = picture.getColorProfile();
        // The profile's bytes are a view of memory that stripping frees.
        const colorProfileBytes = colorProfile?.data.slice();
        picture.strip();
        if (colorProfile && colorProfileBytes) {
          picture.setProfile(colorProfile.name, colorProfileBytes);
        }
      })
    )
  );

const candidateTypes = (
  picture: IMagickImage,
  type: string
): ReadonlyArray<EncodedType> => {
  if (!picture.isOpaque) return ["image/png"];
  return losslessTypes.includes(type)
    ? ["image/png", "image/jpeg"]
    : ["image/jpeg"];
};

/**
 * The smallest candidate encoding at `width`. When that's still too large,
 * the next width shrinks the area by about the share it was over.
 */
const encodeToFit: (
  picture: IMagickImage,
  fit: ImageFit,
  width: number,
  types: ReadonlyArray<EncodedType>
) => Effect.Effect<EncodedImage, ImageTooLargeError> = Effect.fn("encodeToFit")(
  function* (picture, fit, width, types) {
    const smallest = yield* Effect.sync(() =>
      picture.clone((copy) => {
        if (width < copy.width) copy.resize(width, 0);
        return types
          .map((type) => encode(copy, type, fit.maxBytes))
          .reduce((best, next) =>
            next.bytes.byteLength < best.bytes.byteLength ? next : best
          );
      })
    );
    if (smallest.bytes.byteLength <= fit.maxBytes) return smallest;
    if (width <= minWidth) return yield* new ImageTooLargeError();
    return yield* encodeToFit(
      picture,
      fit,
      narrower(width, smallest.bytes.byteLength, fit),
      types
    );
  }
);

const narrower = (width: number, encodedBytes: number, fit: ImageFit) =>
  Math.max(
    minWidth,
    Math.floor(
      width * clamp(0.95 * Math.sqrt(fit.maxBytes / encodedBytes), 0.5, 0.9)
    )
  );

const magickFormats = {
  "image/jpeg": MagickFormat.Jpeg,
  "image/png": MagickFormat.Png,
} as const satisfies Record<EncodedType, MagickFormat>;

const encode = (
  picture: IMagickImage,
  type: EncodedType,
  maxBytes: number
): EncodedImage => {
  if (type === "image/jpeg") {
    picture.settings.setDefine(MagickFormat.Jpeg, "extent", maxBytes);
  }
  // The callback's bytes live in ImageMagick's memory, so they're copied out.
  const bytes = picture.write(magickFormats[type], (data) => data.slice());
  return { bytes, type };
};

const fileName = (name: string, type: EncodedType) =>
  `${name.replace(/\.[^.]*$/, "") || "image"}.${type === "image/jpeg" ? "jpg" : "png"}`;
