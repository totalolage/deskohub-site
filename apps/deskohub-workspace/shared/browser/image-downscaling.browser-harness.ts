import { Effect } from "effect";
import { downscaleImage, type ImageDownscaleLimits } from "./image-downscaling";
import { runWorkspaceBrowserEffect } from "./workspace-browser-effect";

/** A synthetic picture the harness draws, then downscales. */
export interface DownscaleCase {
  readonly width: number;
  readonly height: number;
  readonly type: "image/png" | "image/jpeg";
  /** Clears a corner to transparent. */
  readonly transparent: boolean;
  /** Stores the picture sideways with EXIF orientation 6 (JPEG only). */
  readonly sideways: boolean;
  /** Replaces the picture with bytes no browser decodes. */
  readonly undecodable: boolean;
  readonly limits: ImageDownscaleLimits;
}

/** What the browser test reads back. */
export type DownscaleReport =
  | { readonly outcome: "ImageDecodeError" }
  | {
      readonly outcome: "downscaled";
      readonly type: string;
      readonly bytes: number;
      readonly width: number;
      readonly height: number;
      readonly transparent: boolean;
    };

declare global {
  interface Window {
    downscale: (input: DownscaleCase) => Promise<DownscaleReport>;
  }
}

/** An EXIF APP1 segment that says: rotate 90° clockwise to show upright. */
const sidewaysExif = new Uint8Array([
  0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00,
  0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00,
  0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const draw = (input: DownscaleCase) =>
  Effect.promise(async () => {
    if (input.undecodable) return new Blob([new Uint8Array(64).fill(7)]);
    const canvas = new OffscreenCanvas(input.width, input.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas context.");
    // Noise keeps the encoded file heavy, as a photo's is.
    const pixels = context.createImageData(input.width, input.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      pixels.data[index] = (index * 7) % 251;
      pixels.data[index + 1] = Math.floor(Math.random() * 256);
      pixels.data[index + 2] = (index >> 10) % 256;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    if (input.transparent)
      context.clearRect(0, 0, input.width / 4, input.height / 4);
    const encoded = await canvas.convertToBlob({ type: input.type });
    if (!input.sideways) return encoded;
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    return new Blob([bytes.slice(0, 2), sidewaysExif, bytes.slice(2)], {
      type: input.type,
    });
  });

const describeImage = (file: Blob) =>
  Effect.promise(async (): Promise<DownscaleReport> => {
    const picture = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(picture.width, picture.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas context.");
    context.drawImage(picture, 0, 0);
    const { data } = context.getImageData(0, 0, picture.width, picture.height);
    return {
      outcome: "downscaled",
      type: file.type,
      bytes: file.size,
      width: picture.width,
      height: picture.height,
      transparent: data.some((value, index) => index % 4 === 3 && value < 255),
    };
  });

window.downscale = (input) =>
  draw(input).pipe(
    Effect.flatMap((file) => downscaleImage(file, input.limits)),
    Effect.flatMap(describeImage),
    Effect.catchTag("ImageDecodeError", () =>
      Effect.succeed<DownscaleReport>({ outcome: "ImageDecodeError" })
    ),
    runWorkspaceBrowserEffect("image-downscaling.browser-harness")
  );
