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

/**
 * Far longer than shrinking takes, so only a worker that died without a word
 * reaches it.
 */
const workerReplyTimeout = "2 minutes";

/**
 * Returns the file unchanged when its type is accepted and it's within
 * `fit.maxBytes`. Otherwise re-encodes it in a Web Worker, as
 * `reencodeImageToFit` describes, so the page stays responsive. The worker and
 * its WebAssembly codecs load only then, and interrupting stops the worker.
 */
export const shrinkImageToFit = Effect.fn("shrinkImageToFit")(function* (
  file: File,
  fit: ImageFit
) {
  if (imageFitsAsIs(file, fit)) return file;
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
