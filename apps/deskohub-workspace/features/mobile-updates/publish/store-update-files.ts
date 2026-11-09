import { Effect, Option } from "effect";
import type { UpdateFile } from "./exported-update";
import { UpdateAssetStorage } from "./update-asset-storage.service";

interface StoredUpdateFiles {
  /** The URL of every file, by its pathname. */
  readonly assetUrls: ReadonlyMap<string, string>;
  readonly uploaded: number;
  readonly reused: number;
}

/** Blob rate-limits a store's writes, so a publish uploads a few at a time. */
const uploadConcurrency = 4;

/**
 * Stores the files of one or more updates. Pathnames are content addresses,
 * so a file already stored, by an earlier publish or another platform's
 * update, is reused as it is.
 */
export const storeUpdateFiles = Effect.fn("storeUpdateFiles")(function* (
  files: readonly UpdateFile[]
) {
  const storage = yield* UpdateAssetStorage;
  const unique = [
    ...new Map(files.map((file) => [file.pathname, file])).values(),
  ];

  const stored = yield* Effect.forEach(
    unique,
    (file) =>
      storage.find(file.pathname).pipe(
        Effect.flatMap(
          Option.match({
            onSome: (url) => Effect.succeed({ url, reused: true }),
            onNone: () => uploadMissing(file),
          })
        ),
        Effect.map(({ url, reused }) => ({
          pathname: file.pathname,
          url,
          reused,
        }))
      ),
    { concurrency: uploadConcurrency }
  );

  const reused = stored.filter((file) => file.reused).length;
  return {
    assetUrls: new Map(stored.map(({ pathname, url }) => [pathname, url])),
    uploaded: stored.length - reused,
    reused,
  } satisfies StoredUpdateFiles;
});

/**
 * Uploads a file the store lacked. When the upload fails because another
 * publish stored the same content meanwhile, that copy is reused.
 */
const uploadMissing = Effect.fnUntraced(function* (file: UpdateFile) {
  const storage = yield* UpdateAssetStorage;
  return yield* storage.upload(file).pipe(
    Effect.map((url) => ({ url, reused: false })),
    Effect.catchTag("UpdateAssetStorageUnavailable", (failure) =>
      storage.find(file.pathname).pipe(
        Effect.flatMap(
          Option.match({
            onSome: (url) => Effect.succeed({ url, reused: true }),
            onNone: () => Effect.fail(failure),
          })
        )
      )
    )
  );
});
