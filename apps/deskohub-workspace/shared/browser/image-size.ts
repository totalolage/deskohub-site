import { Effect, Option } from "effect";

/** A picture's size in pixels, upright as its EXIF orientation says. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The picture's size as the browser shows it, or none when the browser can't
 * read it. Loading the picture this way reads its header without decoding it
 * for the page.
 */
export const readImageSize = (
  file: Blob
): Effect.Effect<Option.Option<ImageSize>> =>
  Effect.acquireUseRelease(
    Effect.sync(() => URL.createObjectURL(file)),
    (url) =>
      Effect.callback<Option.Option<ImageSize>>((resume) => {
        const picture = new Image();
        picture.addEventListener("load", () =>
          resume(
            Effect.succeed(
              Option.some({
                width: picture.naturalWidth,
                height: picture.naturalHeight,
              })
            )
          )
        );
        picture.addEventListener("error", () =>
          resume(Effect.succeed(Option.none()))
        );
        picture.src = url;
        return Effect.sync(() => picture.removeAttribute("src"));
      }),
    (url) => Effect.sync(() => URL.revokeObjectURL(url))
  );
