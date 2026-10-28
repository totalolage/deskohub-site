import { Data, Option } from "effect";

/** The file can't be decoded as an image. */
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
  /** The widest accepted picture, upright, in pixels. */
  readonly maxWidth: number;
  /** Media types used unchanged while the picture is within both limits. */
  readonly acceptedTypes: ReadonlyArray<string>;
}

/**
 * Whether the file can be used as it is, with no re-encoding, given its
 * picture's upright width. A picture whose width isn't known doesn't fit.
 */
export const imageFitsAsIs = (
  file: Blob,
  width: Option.Option<number>,
  fit: ImageFit
): boolean =>
  fit.acceptedTypes.includes(file.type) &&
  file.size <= fit.maxBytes &&
  Option.exists(width, (known) => known <= fit.maxWidth);
