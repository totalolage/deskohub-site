import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Data, Effect, Schema } from "effect";
import type {
  MobileUpdateAsset,
  MobileUpdatePlatform,
  MobileUpdatePublication,
} from "../mobile-update-publication";

/**
 * One file of an exported update: where the update store keeps it, its bytes,
 * and how a manifest describes it apart from its URL.
 */
export interface UpdateFile {
  readonly pathname: string;
  readonly bytes: Uint8Array;
  readonly asset: Omit<MobileUpdateAsset, "url">;
}

/** One platform's update as `expo export` wrote it. */
export interface ExportedUpdate {
  readonly platform: MobileUpdatePlatform;
  readonly launchAsset: UpdateFile;
  readonly assets: readonly UpdateFile[];
}

/** What a publication adds to an exported update. */
export interface UpdateRelease {
  readonly id: string;
  readonly runtimeVersion: string;
  readonly expoClient: Schema.Json;
  /** The URL of every stored file, by its pathname. */
  readonly assetUrls: ReadonlyMap<string, string>;
}

class ExportedUpdateUnreadable extends Data.TaggedError(
  "ExportedUpdateUnreadable"
)<{ readonly message: string; readonly cause?: unknown }> {}

/** Files are stored under the SHA-256 of their bytes, so they never change. */
const storedPathPrefix = "mobile-updates/assets/";

/** The launch asset is the Hermes or JavaScript bundle the app runs. */
const launchAssetContentType = "application/javascript";

/** Content types of the asset file types Expo apps bundle. */
const assetContentTypes: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  heic: "image/heic",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  json: "application/json",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp4: "video/mp4",
  mov: "video/quicktime",
  html: "text/html",
  txt: "text/plain",
};

const ExportFileMetadata = Schema.Struct({
  bundle: Schema.String,
  assets: Schema.Array(
    Schema.Struct({ path: Schema.String, ext: Schema.String })
  ),
});
type ExportFileMetadata = typeof ExportFileMetadata.Type;

/** `metadata.json`, which `expo export` writes beside the exported files. */
const ExportMetadata = Schema.fromJsonString(
  Schema.Struct({
    fileMetadata: Schema.Record(Schema.String, ExportFileMetadata),
  })
);

/**
 * Reads the update `expo export` wrote to `directory` for each platform, in
 * the order given.
 */
export const readExportedUpdates = Effect.fn("readExportedUpdates")(function* (
  directory: string,
  platforms: readonly MobileUpdatePlatform[]
) {
  const { fileMetadata } = yield* readExportMetadata(directory);

  return yield* Effect.forEach(platforms, (platform) => {
    const files = fileMetadata[platform];
    return files === undefined
      ? Effect.fail(
          new ExportedUpdateUnreadable({
            message: `The export has no ${platform} update`,
          })
        )
      : readPlatformUpdate(directory, platform, files);
  });
});

/** The publication of an exported update whose files are all stored. */
export const toUpdatePublication = (
  { platform, launchAsset, assets }: ExportedUpdate,
  { id, runtimeVersion, expoClient, assetUrls }: UpdateRelease
): MobileUpdatePublication => {
  const withUrl = ({ pathname, asset }: UpdateFile): MobileUpdateAsset => {
    const url = assetUrls.get(pathname);
    if (url === undefined) {
      throw new Error(`The update file ${pathname} was never stored`);
    }
    return { ...asset, url };
  };

  return {
    type: "update",
    id,
    platform,
    runtimeVersion,
    launchAsset: withUrl(launchAsset),
    assets: assets.map(withUrl),
    metadata: {},
    extra: { expoClient },
  };
};

const readExportMetadata = (directory: string) =>
  readExportFile(join(directory, "metadata.json")).pipe(
    Effect.map((bytes) => new TextDecoder().decode(bytes)),
    Effect.flatMap(Schema.decodeUnknownEffect(ExportMetadata)),
    Effect.mapError(
      (cause) =>
        new ExportedUpdateUnreadable({
          message: "The export's metadata.json is unreadable",
          cause,
        })
    )
  );

const readPlatformUpdate = (
  directory: string,
  platform: MobileUpdatePlatform,
  { bundle, assets }: ExportFileMetadata
) =>
  Effect.all({
    launchAsset: readExportFile(join(directory, bundle)).pipe(
      Effect.map((bytes) =>
        describeFile(bytes, extname(bundle), {
          contentType: launchAssetContentType,
        })
      )
    ),
    assets: Effect.forEach(assets, ({ path, ext }) =>
      readExportFile(join(directory, path)).pipe(
        Effect.map((bytes) =>
          describeFile(bytes, `.${ext}`, {
            contentType:
              assetContentTypes[ext.toLowerCase()] ??
              "application/octet-stream",
            fileExtension: `.${ext}`,
          })
        )
      )
    ),
  }).pipe(Effect.map((files): ExportedUpdate => ({ platform, ...files })));

const readExportFile = (path: string) =>
  Effect.tryPromise({
    try: () => readFile(path),
    catch: (cause) =>
      new ExportedUpdateUnreadable({
        message: `The exported file ${path} is unreadable`,
        cause,
      }),
  });

/**
 * Describes a file the way the Expo Updates protocol identifies it: `hash`
 * is the base64url SHA-256 the app checks after the download, and `key` the
 * MD5 Metro names assets by.
 */
const describeFile = (
  bytes: Uint8Array,
  storedExtension: string,
  description: Pick<MobileUpdateAsset, "contentType" | "fileExtension">
): UpdateFile => {
  const sha256 = createHash("sha256").update(bytes);
  return {
    pathname: `${storedPathPrefix}${sha256.copy().digest("hex")}${storedExtension}`,
    bytes,
    asset: {
      hash: sha256.digest("base64url"),
      key: createHash("md5").update(bytes).digest("hex"),
      ...description,
    },
  };
};
