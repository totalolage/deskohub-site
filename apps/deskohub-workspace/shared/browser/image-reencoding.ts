import mozjpeg from "@jsquash/jpeg/encode";
// OxiPNG's single-threaded build, imported directly: the package entry also
// pulls in a multi-threaded build that needs cross-origin isolation, and its
// self-spawning worker stalls the production build.
import initOxipng, {
  optimise_raw as optimisePng,
} from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import resize from "@jsquash/resize";
import { Effect } from "effect";
import { isAnimatedImage } from "@/shared/utils/image-animation";
import { clamp } from "@/shared/utils/number";
import {
  ImageDecodeError,
  type ImageFit,
  ImageTooLargeError,
} from "./image-fit";

/**
 * MozJPEG quality for a re-encoded picture, and the highest one tried. At
 * twice the display width its artefacts are hard to see.
 */
const preferredJpegQuality = 85;

/** Below this quality a narrower picture looks better than a blurrier one. */
const lowestJpegQuality = 60;

/**
 * Chroma subsampling: photos keep colour at half resolution (4:2:0), as
 * cameras do; drawings keep it at full resolution (4:4:4), so coloured text
 * stays sharp.
 */
const photoChroma = 2;
const drawingChroma = 1;

/** The longest side decoded; iOS Safari's canvas holds no more. */
const maxDecodedSide = 4096;

/** Narrower than this, an image is too small to be worth sending. */
const minWidth = 256;

/** Formats whose pictures are usually drawings, kept lossless when they fit. */
const losslessTypes: ReadonlyArray<string> = ["image/png", "image/gif"];

interface EncodedImage {
  readonly bytes: ArrayBuffer | Uint8Array<ArrayBuffer>;
  readonly type: "image/jpeg" | "image/png";
}

/**
 * Re-encodes the image so it fits: turned upright as its EXIF orientation
 * says, at most `fit.maxWidth` wide, and within `fit.maxBytes`. A picture
 * with transparency becomes a lossless PNG. An opaque PNG or GIF stays a
 * lossless PNG when that fits and becomes a JPEG otherwise; any other opaque
 * picture becomes a JPEG at the highest quality that fits. Only when even the
 * lowest quality is too large does the picture get narrower. An animation
 * isn't re-encoded, since only its first frame would survive.
 */
export const reencodeImageToFit = Effect.fn("reencodeImageToFit")(function* (
  file: File,
  fit: ImageFit
) {
  const bytes = yield* Effect.promise(() => file.arrayBuffer());
  if (isAnimatedImage(new Uint8Array(bytes))) {
    return yield* new ImageTooLargeError();
  }
  const pixels = yield* decode(file, fit);
  const width = Math.min(pixels.width, fit.maxWidth);
  const encoded = hasTransparency(pixels)
    ? yield* encodePngToFit(pixels, fit, width)
    : yield* encodeOpaqueToFit(pixels, fit, width, file.type);
  return new File([encoded.bytes], fileName(file.name, encoded.type), {
    type: encoded.type,
    lastModified: file.lastModified,
  });
});

/**
 * The upright picture's pixels, at most twice `fit.maxWidth` wide and no
 * taller than the canvas holds: enough detail for the final Lanczos
 * resampling, while every copy stays small.
 */
const decode = (file: File, fit: ImageFit) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => createImageBitmap(file, { imageOrientation: "from-image" }),
      catch: () => new ImageDecodeError(),
    }),
    (picture) =>
      Effect.sync(() => {
        const scale = Math.min(
          1,
          (2 * fit.maxWidth) / picture.width,
          maxDecodedSide / picture.height
        );
        const width = Math.max(1, Math.round(picture.width * scale));
        const height = Math.max(1, Math.round(picture.height * scale));
        const context = new OffscreenCanvas(width, height).getContext("2d");
        if (!context) throw new Error("The browser has no 2D canvas.");
        context.imageSmoothingQuality = "high";
        context.drawImage(picture, 0, 0, width, height);
        return context.getImageData(0, 0, width, height);
      }),
    (picture) => Effect.sync(() => picture.close())
  );

const hasTransparency = ({ data }: ImageData) => {
  for (let alpha = 3; alpha < data.length; alpha += 4) {
    if ((data[alpha] ?? 255) < 255) return true;
  }
  return false;
};

const encodeOpaqueToFit = Effect.fn("encodeOpaqueToFit")(function* (
  pixels: ImageData,
  fit: ImageFit,
  width: number,
  type: string
) {
  if (!losslessTypes.includes(type)) {
    return yield* encodeJpegToFit(pixels, fit, width, photoChroma);
  }
  const png = yield* encodePng(yield* resizeTo(pixels, width));
  if (png.bytes.byteLength <= fit.maxBytes) return png;
  return yield* encodeJpegToFit(pixels, fit, width, drawingChroma);
});

/**
 * The highest JPEG quality that fits at `width`, found by a binary search
 * over real encodes. When even the lowest quality is too large, the next
 * width shrinks the area by about the share it was over.
 */
const encodeJpegToFit: (
  pixels: ImageData,
  fit: ImageFit,
  width: number,
  chroma: number
) => Effect.Effect<EncodedImage, ImageTooLargeError> = Effect.fn(
  "encodeJpegToFit"
)(function* (pixels, fit, width, chroma) {
  const scaled = yield* resizeTo(pixels, width);
  const preferred = yield* encodeJpeg(scaled, preferredJpegQuality, chroma);
  if (preferred.bytes.byteLength <= fit.maxBytes) return preferred;
  const lowest = yield* encodeJpeg(scaled, lowestJpegQuality, chroma);
  if (lowest.bytes.byteLength > fit.maxBytes) {
    if (width <= minWidth) return yield* new ImageTooLargeError();
    return yield* encodeJpegToFit(
      pixels,
      fit,
      narrower(width, lowest.bytes.byteLength, fit),
      chroma
    );
  }
  let fitting = lowest;
  let low = lowestJpegQuality;
  let high = preferredJpegQuality - 1;
  while (low < high) {
    const quality = Math.ceil((low + high) / 2);
    const attempt = yield* encodeJpeg(scaled, quality, chroma);
    if (attempt.bytes.byteLength <= fit.maxBytes) {
      fitting = attempt;
      low = quality;
    } else {
      high = quality - 1;
    }
  }
  return fitting;
});

/** A lossless PNG at `width`, or narrower until it fits. */
const encodePngToFit: (
  pixels: ImageData,
  fit: ImageFit,
  width: number
) => Effect.Effect<EncodedImage, ImageTooLargeError> = Effect.fn(
  "encodePngToFit"
)(function* (pixels, fit, width) {
  const png = yield* encodePng(yield* resizeTo(pixels, width));
  if (png.bytes.byteLength <= fit.maxBytes) return png;
  if (width <= minWidth) return yield* new ImageTooLargeError();
  return yield* encodePngToFit(
    pixels,
    fit,
    narrower(width, png.bytes.byteLength, fit)
  );
});

const narrower = (width: number, encodedBytes: number, fit: ImageFit) =>
  Math.max(
    minWidth,
    Math.floor(
      width * clamp(0.95 * Math.sqrt(fit.maxBytes / encodedBytes), 0.5, 0.9)
    )
  );

/**
 * Lanczos resampling in sRGB with alpha premultiplied, as image editors do.
 * In linear light it rings dark around light edges, such as text.
 */
const resizeTo = (pixels: ImageData, width: number) =>
  width >= pixels.width
    ? Effect.succeed(pixels)
    : Effect.promise(() =>
        resize(pixels, {
          width,
          height: Math.max(
            1,
            Math.round((pixels.height * width) / pixels.width)
          ),
          method: "lanczos3",
          fitMethod: "stretch",
          premultiply: true,
          linearRGB: false,
        })
      );

/**
 * A progressive MozJPEG with optimised Huffman tables and trellis
 * quantisation.
 */
const encodeJpeg = (pixels: ImageData, quality: number, chroma: number) =>
  Effect.promise(() =>
    mozjpeg(pixels, {
      quality,
      auto_subsample: false,
      chroma_subsample: chroma,
    })
  ).pipe(Effect.map((bytes): EncodedImage => ({ bytes, type: "image/jpeg" })));

/**
 * A lossless PNG in the smallest colour type and bit depth that hold it, not
 * interlaced. Fully transparent pixels may change colour to compress better.
 */
const encodePng = (pixels: ImageData) =>
  Effect.promise(() => initOxipng()).pipe(
    Effect.map((): EncodedImage => {
      const level = 2;
      const interlace = false;
      const optimiseAlpha = true;
      const bytes = optimisePng(
        pixels.data,
        pixels.width,
        pixels.height,
        level,
        interlace,
        optimiseAlpha
      );
      return { bytes: new Uint8Array(bytes), type: "image/png" };
    })
  );

const fileName = (name: string, type: string) =>
  `${name.replace(/\.[^.]*$/, "") || "image"}.${type === "image/jpeg" ? "jpg" : "png"}`;
