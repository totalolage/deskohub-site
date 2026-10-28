import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Option } from "effect";
import type { ImageFit } from "./image-fit";
import type {
  ImageShrinkingReply,
  ImageShrinkingRequest,
} from "./image-shrinking.worker";

let pictureWidth = Option.some(400);

mock.module("./image-width", () => ({
  readImageWidth: () => Effect.sync(() => pictureWidth),
}));

const requests: ImageShrinkingRequest[] = [];

/** Stands in for the shrinking worker and answers every request at once. */
class ShrinkingWorker extends EventTarget {
  postMessage(request: ImageShrinkingRequest) {
    requests.push(request);
    const reply: ImageShrinkingReply = {
      _tag: "Shrunk",
      file: new File(["shrunk"], "shrunk.jpg", { type: "image/jpeg" }),
    };
    queueMicrotask(() =>
      this.dispatchEvent(new MessageEvent("message", { data: reply }))
    );
  }

  terminate() {}
}

const nativeWorker = globalThis.Worker;
Object.defineProperty(globalThis, "Worker", {
  configurable: true,
  value: ShrinkingWorker,
});
afterAll(() => {
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: nativeWorker,
  });
});

const { shrinkImageToFit } = await import("./image-shrinking");

const fit: ImageFit = {
  maxBytes: 1000,
  maxWidth: 500,
  acceptedTypes: ["image/png", "image/gif"],
};

const shrink = async (file: File) => {
  let shrinking = false;
  const result = await Effect.runPromise(
    shrinkImageToFit(
      file,
      fit,
      Effect.sync(() => {
        shrinking = true;
      })
    )
  );
  return { result, shrinking };
};

beforeEach(() => {
  pictureWidth = Option.some(400);
  requests.length = 0;
});

describe("shrinkImageToFit", () => {
  test("uses a file within both limits as it is", async () => {
    const file = new File([new Uint8Array(1000)], "fits.gif", {
      type: "image/gif",
    });

    const { result, shrinking } = await shrink(file);

    expect(result).toBe(file);
    expect(shrinking).toBe(false);
    expect(requests).toEqual([]);
  });

  test.each([
    ["is wider than the fit", { width: Option.some(501) }],
    ["is a larger file than the fit", { bytes: 1001 }],
    ["is in a format the upload doesn't take", { type: "image/bmp" }],
    ["can't be read by the browser", { width: Option.none<number>() }],
  ])("shrinks a picture that %s", async (_name, change) => {
    pictureWidth = change.width ?? pictureWidth;
    const file = new File([new Uint8Array(change.bytes ?? 10)], "big.png", {
      type: change.type ?? "image/png",
    });

    const { result, shrinking } = await shrink(file);

    expect(result.name).toBe("shrunk.jpg");
    expect(shrinking).toBe(true);
    expect(requests).toEqual([{ file, fit }]);
  });
});
