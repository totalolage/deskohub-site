import { Effect, Layer, Option } from "effect";
import {
  UpdateAssetStorage,
  UpdateAssetStorageUnavailable,
} from "./update-asset-storage.service";

/**
 * An in-memory update store. `stored` files exist from the start,
 * `storedDuringUpload` files appear when this publish tries to upload them
 * (as if another publish won the race), and `failedUploads` never upload.
 */
export const memoryUpdateAssetStorage = ({
  stored = [],
  storedDuringUpload = [],
  failedUploads = [],
}: {
  readonly stored?: readonly string[];
  readonly storedDuringUpload?: readonly string[];
  readonly failedUploads?: readonly string[];
}) => {
  const urlOf = (pathname: string) => `https://blob.test/${pathname}`;
  const files = new Set(stored);
  const uploads: string[] = [];
  const uploadedContentTypes = new Map<string, string>();

  const layer = Layer.succeed(UpdateAssetStorage, {
    find: (pathname) =>
      Effect.sync(() =>
        files.has(pathname) ? Option.some(urlOf(pathname)) : Option.none()
      ),
    upload: ({ pathname, asset }) => {
      if (
        storedDuringUpload.includes(pathname) ||
        failedUploads.includes(pathname)
      ) {
        if (storedDuringUpload.includes(pathname)) files.add(pathname);
        return Effect.fail(
          new UpdateAssetStorageUnavailable({
            operation: "upload",
            pathname,
            message: `Blob upload of ${pathname} failed`,
          })
        );
      }
      if (files.has(pathname)) {
        return Effect.die(new Error(`Overwrote stored file ${pathname}`));
      }
      return Effect.sync(() => {
        files.add(pathname);
        uploads.push(pathname);
        uploadedContentTypes.set(pathname, asset.contentType);
        return urlOf(pathname);
      });
    },
  });

  return { layer, uploads, uploadedContentTypes, urlOf };
};
