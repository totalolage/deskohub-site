import { Data, Effect } from "effect";
import sharp from "sharp";

/**
 * Avatar input policy (see docs/customer-account-avatars.md): the raw upload
 * is at most 2 MiB, and the normalized output is WebP bounded to 512x512.
 */
export const customerAvatarMaxUploadBytes = 2 * 1024 * 1024;
export const customerAvatarOutputMaxDimension = 512;

/**
 * Pixel-bomb cap: an input whose decoded dimensions exceed this bound is
 * rejected before any pixel data is decoded into memory.
 */
export const customerAvatarMaxInputDimension = 10_000;

export const customerAvatarAllowedMediaTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type CustomerAvatarMediaType =
  (typeof customerAvatarAllowedMediaTypes)[number];

const allowedSharpFormats = new Set(["jpeg", "png", "webp"]);

/**
 * Closed public rejection contract. Each reason names one recognized input
 * policy violation; values are safe to expose to the client and to log.
 */
export type CustomerAvatarRejectionReason =
  | "file-missing"
  | "file-too-large"
  | "unsupported-format"
  | "undecodable-image"
  | "image-dimensions-too-large";

export class CustomerAvatarRejectedError extends Data.TaggedError(
  "CustomerAvatarRejectedError"
)<{
  readonly reason: CustomerAvatarRejectionReason;
}> {}

const rejected = (reason: CustomerAvatarRejectionReason) =>
  Effect.fail(new CustomerAvatarRejectedError({ reason }));

const inputDimensionsTooLarge = (width: number, height: number) =>
  width > customerAvatarMaxInputDimension ||
  height > customerAvatarMaxInputDimension;

/**
 * Decodes the raw upload far enough to verify it is a genuinely decodable
 * JPEG, PNG, or WebP image within the pixel-bomb cap, then re-encodes it as
 * the normalized WebP avatar: at most 512x512, the customer's aspect ratio,
 * with all metadata stripped. The normalized bytes, never the customer's
 * original upload, are what reach storage.
 */
export const normalizeCustomerAvatar = (
  bytes: Uint8Array
): Effect.Effect<Uint8Array, CustomerAvatarRejectedError> =>
  Effect.gen(function* () {
    const probed = yield* Effect.tryPromise({
      try: () =>
        sharp(bytes, {
          failOn: "error",
          limitInputPixels:
            customerAvatarMaxInputDimension * customerAvatarMaxInputDimension,
        }).metadata(),
      catch: () =>
        new CustomerAvatarRejectedError({ reason: "undecodable-image" }),
    });

    if (!probed.format || !allowedSharpFormats.has(probed.format)) {
      return yield* rejected("unsupported-format");
    }

    if (!probed.width || !probed.height) {
      return yield* rejected("undecodable-image");
    }

    if (inputDimensionsTooLarge(probed.width, probed.height)) {
      return yield* rejected("image-dimensions-too-large");
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const output = await sharp(bytes, {
          failOn: "error",
          limitInputPixels:
            customerAvatarMaxInputDimension * customerAvatarMaxInputDimension,
        })
          .rotate()
          .resize(
            customerAvatarOutputMaxDimension,
            customerAvatarOutputMaxDimension,
            {
              fit: "inside",
              withoutEnlargement: true,
            }
          )
          .webp()
          .toBuffer();
        return new Uint8Array(output);
      },
      catch: () =>
        new CustomerAvatarRejectedError({ reason: "undecodable-image" }),
    });
  });
