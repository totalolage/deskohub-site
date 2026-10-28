import { Effect, Option } from "effect";

/**
 * The picture's width as the browser shows it, upright as its EXIF
 * orientation says, or none when the browser can't read it. Loading the
 * picture this way reads its header without decoding it for the page.
 */
export const readImageWidth = (
  file: Blob
): Effect.Effect<Option.Option<number>> =>
  Effect.acquireUseRelease(
    Effect.sync(() => URL.createObjectURL(file)),
    (url) =>
      Effect.callback<Option.Option<number>>((resume) => {
        const picture = new Image();
        picture.addEventListener("load", () =>
          resume(Effect.succeed(Option.some(picture.naturalWidth)))
        );
        picture.addEventListener("error", () =>
          resume(Effect.succeed(Option.none()))
        );
        picture.src = url;
        return Effect.sync(() => picture.removeAttribute("src"));
      }),
    (url) => Effect.sync(() => URL.revokeObjectURL(url))
  );
