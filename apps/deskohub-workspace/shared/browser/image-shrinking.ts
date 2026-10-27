import { Data, Effect } from "effect";
import { clamp } from "@/shared/utils/number";

/** The browser can't decode the file as an image. */
export class ImageDecodeError extends Data.TaggedError("ImageDecodeError")<{
  readonly cause: unknown;
}> {}

/**
 * No reasonable re-encoding fits the byte limit, or the image can't be
 * re-encoded without losing content, such as a GIF's animation.
 */
export class ImageTooLargeError extends Data.TaggedError(
  "ImageTooLargeError"
) {}

/** What an image has to satisfy to be used. */
export interface ImageFit {
  /** The largest accepted file, in bytes. */
  readonly maxBytes: number;
  /** The widest an image becomes once it has to be downscaled, in pixels. */
  readonly maxWidth: number;
  /** Media types used unchanged while they're within `maxBytes`. */
  readonly acceptedTypes: ReadonlyArray<string>;
}

/** Whether the file can be used as it is, with no re-encoding. */
export const imageFitsAsIs = (file: File, fit: ImageFit): boolean =>
  fit.acceptedTypes.includes(file.type) && file.size <= fit.maxBytes;

interface ImageEncoding {
  readonly type: string;
  /** Qualities to try at each width, best first; lossless formats have none. */
  readonly qualities: ReadonlyArray<number | undefined>;
}

const lossy = (type: string): ImageEncoding => ({
  type,
  qualities: [0.9, 0.8, 0.7, 0.6],
});

const lossless = (type: string): ImageEncoding => ({
  type,
  qualities: [undefined],
});

/** The longest canvas side every supported browser draws, iOS Safari's. */
const maxCanvasSide = 4096;

/** Narrower than this, an image is too small to be worth sending. */
const minWidth = 256;

/**
 * Returns the file unchanged when its type is accepted and it's within
 * `fit.maxBytes`. Otherwise decodes it, turned upright as its EXIF
 * orientation says, and re-encodes it until it fits: JPEG and WebP at falling
 * quality and then smaller, PNG smaller in the same format. Other formats the
 * browser can decode become PNG when they have transparency and JPEG when
 * they don't. GIF isn't re-encoded, since a canvas keeps only its first frame.
 */
export const shrinkImageToFit = Effect.fn("shrinkImageToFit")(
  function* (file: File, fit: ImageFit) {
    if (imageFitsAsIs(file, fit)) return file;
    if (file.type === "image/gif") return yield* new ImageTooLargeError();
    const picture = yield* decode(file);
    const encoding = yield* encodingFor(file.type, picture);
    const encoded = yield* encodeToFit(
      picture,
      encoding,
      fit,
      initialWidth(picture)
    );
    return new File([encoded], fileName(file.name, encoded.type), {
      type: encoded.type,
      lastModified: file.lastModified,
    });
  },
  Effect.scoped
);

const decode = (file: File) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => createImageBitmap(file, { imageOrientation: "from-image" }),
      catch: (cause) => new ImageDecodeError({ cause }),
    }),
    (picture) => Effect.sync(() => picture.close())
  );

const encodingFor = Effect.fn("encodingFor")(function* (
  type: string,
  picture: ImageBitmap
) {
  switch (type) {
    case "image/jpeg":
    case "image/webp":
      return lossy(type);
    case "image/png":
      return lossless(type);
    default:
      return (yield* hasTransparency(picture))
        ? lossless("image/png")
        : lossy("image/jpeg");
  }
});

/**
 * Tries each quality at `width`, then a narrower width, until the encoded
 * picture fits. The first downscale goes to `fit.maxWidth`; later ones shrink
 * the area by about the share the last attempt was over.
 */
const encodeToFit: (
  picture: ImageBitmap,
  encoding: ImageEncoding,
  fit: ImageFit,
  width: number
) => Effect.Effect<Blob, ImageTooLargeError> = Effect.fn("encodeToFit")(
  function* (picture, encoding, fit, width) {
    let smallest = Number.POSITIVE_INFINITY;
    for (const quality of encoding.qualities) {
      const encoded = yield* encode(picture, width, encoding.type, quality);
      if (encoded.size <= fit.maxBytes) return encoded;
      smallest = Math.min(smallest, encoded.size);
      // A browser that can't write the format falls back to PNG, which
      // ignores quality.
      if (encoded.type !== encoding.type) break;
    }
    if (width <= minWidth) return yield* new ImageTooLargeError();
    return yield* encodeToFit(
      picture,
      encoding,
      fit,
      nextWidth(width, smallest, fit)
    );
  }
);

/** The picture's own width, unless the canvas couldn't hold it. */
const initialWidth = (picture: ImageBitmap) =>
  Math.max(
    1,
    Math.floor(
      picture.width *
        Math.min(
          1,
          maxCanvasSide / picture.width,
          maxCanvasSide / picture.height
        )
    )
  );

const nextWidth = (width: number, encodedBytes: number, fit: ImageFit) =>
  width > fit.maxWidth
    ? fit.maxWidth
    : Math.max(
        minWidth,
        Math.floor(
          width *
            clamp(0.95 * Math.sqrt(fit.maxBytes / encodedBytes), 0.5, 0.85)
        )
      );

const encode = (
  picture: ImageBitmap,
  width: number,
  type: string,
  quality: number | undefined
) =>
  draw(picture, width).pipe(
    Effect.flatMap(({ canvas }) =>
      Effect.promise(() => canvas.convertToBlob({ type, quality }))
    )
  );

/** Draws the picture scaled to `width`, keeping its aspect ratio. */
const draw = (picture: ImageBitmap, width: number) =>
  Effect.suspend(() => {
    const height = Math.max(
      1,
      Math.round((picture.height * width) / picture.width)
    );
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      return Effect.die(new Error("The browser has no 2D canvas."));
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(picture, 0, 0, width, height);
    return Effect.succeed({ canvas, context });
  });

/** Whether any pixel of the picture, drawn at its first width, isn't opaque. */
const hasTransparency = (picture: ImageBitmap) =>
  draw(picture, initialWidth(picture)).pipe(
    Effect.map(({ canvas, context }) => {
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let alpha = 3; alpha < data.length; alpha += 4) {
        if ((data[alpha] ?? 255) < 255) return true;
      }
      return false;
    })
  );

const fileName = (name: string, type: string) =>
  `${name.replace(/\.[^.]*$/, "") || "image"}.${type.split("/")[1] ?? "img"}`;
