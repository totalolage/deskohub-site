import { Data } from "effect";

/** The browser can't decode the file as an image. */
export class ImageDecodeError extends Data.TaggedError("ImageDecodeError") {}

/**
 * No reasonable re-encoding fits the byte limit, or the image can't be
 * re-encoded without losing content, such as an animation.
 */
export class ImageTooLargeError extends Data.TaggedError(
  "ImageTooLargeError"
) {}

/** What an image has to satisfy to be used. */
export interface ImageFit {
  /** The largest accepted file, in bytes. */
  readonly maxBytes: number;
  /** The widest an image becomes once it has to be re-encoded, in pixels. */
  readonly maxWidth: number;
  /** Media types used unchanged while they're within `maxBytes`. */
  readonly acceptedTypes: ReadonlyArray<string>;
}

/** Whether the file can be used as it is, with no re-encoding. */
export const imageFitsAsIs = (file: File, fit: ImageFit): boolean =>
  fit.acceptedTypes.includes(file.type) && file.size <= fit.maxBytes;
