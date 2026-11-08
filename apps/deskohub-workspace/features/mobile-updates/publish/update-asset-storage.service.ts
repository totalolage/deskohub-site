import { BlobNotFoundError, head, put } from "@vercel/blob";
import { Context, Data, Effect, Layer, Option, Redacted } from "effect";
import type { UpdateFile } from "./exported-update";
import {
  MobileUpdatePublishConfig,
  MobileUpdatePublishConfigInvalid,
} from "./mobile-update-publish-config";

export class UpdateAssetStorageUnavailable extends Data.TaggedError(
  "UpdateAssetStorageUnavailable"
)<{
  readonly operation: "find" | "upload";
  readonly pathname: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface IUpdateAssetStorage {
  /** The URL of the file stored at `pathname`, if one is. */
  readonly find: (
    pathname: string
  ) => Effect.Effect<Option.Option<string>, UpdateAssetStorageUnavailable>;
  /**
   * Stores a file at its pathname and gives its URL. It never replaces a
   * stored file, so it fails when one is already there.
   */
  readonly upload: (
    file: UpdateFile
  ) => Effect.Effect<string, UpdateAssetStorageUnavailable>;
}

/** Stored files never change, so apps and CDNs may cache them for a year. */
const storedFileMaxAgeSeconds = 31_536_000;
const findTimeout = "30 seconds";
const uploadTimeout = "2 minutes";

class StoredFileMissing extends Data.TaggedError("StoredFileMissing") {}

/** The public Blob store that serves update files to installed apps. */
export class UpdateAssetStorage extends Context.Service<
  UpdateAssetStorage,
  IUpdateAssetStorage
>()("UpdateAssetStorage") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { blobToken } = yield* MobileUpdatePublishConfig;
      if (Option.isNone(blobToken)) {
        return yield* new MobileUpdatePublishConfigInvalid({
          message: "Set BLOB_READ_WRITE_TOKEN to store update files",
        });
      }
      const token = Redacted.value(blobToken.value);

      const unavailable =
        (operation: "find" | "upload", pathname: string) => (cause: unknown) =>
          new UpdateAssetStorageUnavailable({
            operation,
            pathname,
            message: `Blob ${operation} of ${pathname} failed`,
            cause,
          });

      return {
        find: (pathname) =>
          Effect.tryPromise({
            try: (abortSignal) => head(pathname, { token, abortSignal }),
            catch: (cause) =>
              cause instanceof BlobNotFoundError
                ? new StoredFileMissing()
                : unavailable("find", pathname)(cause),
          }).pipe(
            Effect.map(({ url }) => Option.some(url)),
            Effect.catchTag("StoredFileMissing", () => Effect.succeedNone),
            Effect.timeoutOrElse({
              duration: findTimeout,
              orElse: () =>
                Effect.fail(unavailable("find", pathname)("timeout")),
            })
          ),
        upload: ({ pathname, bytes, asset }) =>
          Effect.tryPromise({
            try: (abortSignal) =>
              put(pathname, Buffer.from(bytes), {
                access: "public",
                addRandomSuffix: false,
                allowOverwrite: false,
                cacheControlMaxAge: storedFileMaxAgeSeconds,
                contentType: asset.contentType,
                token,
                abortSignal,
              }),
            catch: unavailable("upload", pathname),
          }).pipe(
            Effect.map(({ url }) => url),
            Effect.timeoutOrElse({
              duration: uploadTimeout,
              orElse: () =>
                Effect.fail(unavailable("upload", pathname)("timeout")),
            })
          ),
      };
    })
  );
}
