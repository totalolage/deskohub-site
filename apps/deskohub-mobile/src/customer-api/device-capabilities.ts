import { Context, Data, type Effect, type Option } from "effect";

/** A device capability (storage, files, sharing, clipboard, picker) failed. */
export class DeviceCapabilityFailed extends Data.TaggedError(
  "DeviceCapabilityFailed"
)<{
  readonly capability:
    | "storage"
    | "temporary-files"
    | "share"
    | "clipboard"
    | "image-library";
  readonly cause?: unknown;
}> {}

interface IDeviceStorage {
  readonly getItem: (
    key: string
  ) => Effect.Effect<Option.Option<string>, DeviceCapabilityFailed>;
  readonly setItem: (
    key: string,
    value: string
  ) => Effect.Effect<void, DeviceCapabilityFailed>;
  readonly removeItems: (
    keys: ReadonlyArray<string>
  ) => Effect.Effect<void, DeviceCapabilityFailed>;
  readonly keys: Effect.Effect<ReadonlyArray<string>, DeviceCapabilityFailed>;
}

/**
 * Unencrypted key-value storage that survives restarts (AsyncStorage). Never
 * store credentials or PINs in it.
 */
export class DeviceStorage extends Context.Service<
  DeviceStorage,
  IDeviceStorage
>()("DeviceStorage") {}

interface ITemporaryFiles {
  /**
   * Writes `bytes` to a new temporary file of `owner` and answers its URI,
   * never one an earlier write answered, even for the same name.
   */
  readonly write: (
    owner: string,
    name: string,
    bytes: Uint8Array
  ) => Effect.Effect<string, DeviceCapabilityFailed>;
  readonly remove: (uri: string) => Effect.Effect<void>;
  /** Removes the owner's temporary files, or every one the app wrote. */
  readonly sweep: (owner: Option.Option<string>) => Effect.Effect<void>;
}

/** Files the app writes only to hand them to the share sheet, such as an invoice PDF. */
export class TemporaryFiles extends Context.Service<
  TemporaryFiles,
  ITemporaryFiles
>()("TemporaryFiles") {}

interface IShareSheet {
  /** Opens the share sheet (native) or a download (web) for a file. */
  readonly shareFile: (file: {
    readonly uri: string;
    readonly name: string;
    readonly mimeType: string;
  }) => Effect.Effect<void, DeviceCapabilityFailed>;
  readonly shareLink: (link: {
    readonly url: string;
    readonly message?: string;
  }) => Effect.Effect<void, DeviceCapabilityFailed>;
}

export class ShareSheet extends Context.Service<ShareSheet, IShareSheet>()(
  "ShareSheet"
) {}

interface IClipboard {
  /** Copies text; `sensitive` keeps it out of Android's clipboard preview. */
  readonly copy: (
    text: string,
    options: { readonly sensitive: boolean }
  ) => Effect.Effect<void, DeviceCapabilityFailed>;
}

export class Clipboard extends Context.Service<Clipboard, IClipboard>()(
  "Clipboard"
) {}

export interface PickedImage {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string | undefined;
  readonly size: number | undefined;
}

interface IImageLibrary {
  /** Lets the customer pick one image; none when they cancel. */
  readonly pickImage: Effect.Effect<
    Option.Option<PickedImage>,
    DeviceCapabilityFailed
  >;
}

export class ImageLibrary extends Context.Service<
  ImageLibrary,
  IImageLibrary
>()("ImageLibrary") {}

export type DeviceCapabilities =
  | DeviceStorage
  | TemporaryFiles
  | ShareSheet
  | Clipboard
  | ImageLibrary;
