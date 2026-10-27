import { Cause, Effect, Exit, Result } from "effect";
import type {
  ImageDecodeError,
  ImageFit,
  ImageTooLargeError,
} from "./image-fit";
import { reencodeImageToFit } from "./image-reencoding";
import { runWorkspaceBrowserEffect } from "./workspace-browser-effect";

/** What `shrinkImageToFit` asks the worker for. */
export interface ImageShrinkingRequest {
  readonly file: File;
  readonly fit: ImageFit;
}

/**
 * The worker's answer. A defect carries only its error name, since an
 * arbitrary cause may not survive the copy between threads.
 */
export type ImageShrinkingReply =
  | { readonly _tag: "Shrunk"; readonly file: File }
  | { readonly _tag: "ImageDecodeError" }
  | { readonly _tag: "ImageTooLargeError" }
  | { readonly _tag: "Defect"; readonly errorName: string };

interface ImageShrinkingScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ImageShrinkingRequest>) => void
  ): void;
  postMessage(reply: ImageShrinkingReply): void;
}

const scope = globalThis as unknown as ImageShrinkingScope;

const toReply = (
  exit: Exit.Exit<File, ImageDecodeError | ImageTooLargeError>
): ImageShrinkingReply =>
  Exit.match(exit, {
    onSuccess: (file) => ({ _tag: "Shrunk", file }),
    onFailure: (cause) =>
      Result.match(Cause.findError(cause), {
        onSuccess: ({ _tag }) => ({ _tag }),
        onFailure: () => {
          const defect = Cause.squash(cause);
          return {
            _tag: "Defect",
            errorName: defect instanceof Error ? defect.name : typeof defect,
          };
        },
      }),
  });

scope.addEventListener("message", ({ data }) => {
  void reencodeImageToFit(data.file, data.fit).pipe(
    Effect.exit,
    Effect.flatMap((exit) =>
      Effect.sync(() => scope.postMessage(toReply(exit)))
    ),
    runWorkspaceBrowserEffect("image-shrinking.worker")
  );
});
