import { Effect } from "effect";
import {
  ImageDecodeError,
  type ImageFit,
  ImageTooLargeError,
  imageFitsAsIs,
} from "./image-fit";
import type {
  ImageShrinkingReply,
  ImageShrinkingRequest,
} from "./image-shrinking.worker";
import { readImageWidth } from "./image-width";

/**
 * Far longer than shrinking takes, so only a worker that died without a word
 * reaches it.
 */
const workerReplyTimeout = "2 minutes";

/**
 * Returns the file unchanged when its type is accepted and its picture is
 * within both of `fit`'s limits. Otherwise runs `onShrinking`, then
 * re-encodes the file in a Web Worker, as `reencodeImageToFit` describes, so
 * the page stays responsive. The worker and its WebAssembly codec load only
 * then, and interrupting stops the worker.
 */
export const shrinkImageToFit = Effect.fn("shrinkImageToFit")(function* (
  file: File,
  fit: ImageFit,
  onShrinking: Effect.Effect<void> = Effect.void
) {
  if (imageFitsAsIs(file, yield* readImageWidth(file), fit)) return file;
  yield* onShrinking;
  const reply = yield* Effect.acquireUseRelease(
    Effect.sync(
      () =>
        new Worker(new URL("./image-shrinking.worker.ts", import.meta.url), {
          name: "image-shrinking",
          type: "module",
        })
    ),
    (worker) =>
      askWorker(worker, { file, fit }).pipe(
        Effect.timeoutOrElse({
          duration: workerReplyTimeout,
          orElse: () => Effect.die(workerError("TimeoutError")),
        })
      ),
    (worker) => Effect.sync(() => worker.terminate())
  );
  switch (reply._tag) {
    case "Shrunk":
      return reply.file;
    case "ImageDecodeError":
      return yield* new ImageDecodeError();
    case "ImageTooLargeError":
      return yield* new ImageTooLargeError();
    case "Defect":
      return yield* Effect.die(workerError(reply.errorName));
  }
});

const askWorker = (worker: Worker, request: ImageShrinkingRequest) =>
  Effect.callback<ImageShrinkingReply>((resume) => {
    worker.addEventListener("message", (event) =>
      resume(Effect.succeed(event.data))
    );
    // A worker that fails to load or throws reports only an `error` event.
    worker.addEventListener("error", () =>
      resume(Effect.die(workerError("Error")))
    );
    worker.addEventListener("messageerror", () =>
      resume(Effect.die(workerError("DataCloneError")))
    );
    worker.postMessage(request);
  });

const workerError = (name: string) =>
  Object.assign(new Error("Shrinking the image failed in its worker."), {
    name,
  });
