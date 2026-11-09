import AsyncStorage from "@react-native-async-storage/async-storage";
import { Effect, Layer, Option } from "effect";
import * as ExpoClipboard from "expo-clipboard";
import * as ExpoImagePicker from "expo-image-picker";
import {
  Clipboard,
  type DeviceCapabilities,
  DeviceCapabilityFailed,
  DeviceStorage,
  ImageLibrary,
  ShareSheet,
  TemporaryFiles,
} from "./device-capabilities";

const attempt = <A>(
  capability: DeviceCapabilityFailed["capability"],
  run: () => Promise<A> | A
) =>
  Effect.tryPromise({
    try: async () => run(),
    catch: (cause) => new DeviceCapabilityFailed({ capability, cause }),
  });

const storage = Layer.succeed(DeviceStorage, {
  getItem: (key) =>
    attempt("storage", () => AsyncStorage.getItem(key)).pipe(
      Effect.map(Option.fromNullishOr)
    ),
  setItem: (key, value) =>
    attempt("storage", () => AsyncStorage.setItem(key, value)),
  removeItems: (keys) =>
    attempt("storage", () => AsyncStorage.multiRemove([...keys])),
  keys: attempt("storage", () => AsyncStorage.getAllKeys()),
});

// The browser has no app file system: a "temporary file" is an object URL,
// revoked when it is removed or when its owner exits.
const objectUrls = new Map<string, string>();

const revoke = (url: string) => {
  URL.revokeObjectURL(url);
  objectUrls.delete(url);
};

const temporaryFiles = Layer.succeed(TemporaryFiles, {
  write: (owner, _name, bytes) =>
    attempt("temporary-files", () => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
      objectUrls.set(url, owner);
      return url;
    }),
  remove: (url) => Effect.sync(() => revoke(url)),
  sweep: (owner) =>
    Effect.sync(() => {
      for (const [url, urlOwner] of [...objectUrls]) {
        if (Option.getOrElse(owner, () => urlOwner) === urlOwner) revoke(url);
      }
    }),
});

const shareSheet = Layer.succeed(ShareSheet, {
  // A web page can't hand a file to a share sheet reliably; it downloads it.
  shareFile: ({ uri, name }) =>
    attempt("share", () => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = name;
      link.click();
    }),
  shareLink: ({ url, message }) =>
    attempt("share", () =>
      navigator.share === undefined
        ? navigator.clipboard.writeText(url)
        : navigator.share({ url, text: message })
    ),
});

const clipboard = Layer.succeed(Clipboard, {
  copy: (text) =>
    attempt("clipboard", () => ExpoClipboard.setStringAsync(text)).pipe(
      Effect.asVoid
    ),
});

const imageLibrary = Layer.succeed(ImageLibrary, {
  pickImage: attempt("image-library", () =>
    ExpoImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] })
  ).pipe(
    Effect.map((result) =>
      Option.fromNullishOr(result.canceled ? undefined : result.assets[0]).pipe(
        Option.map((asset) => ({
          uri: asset.uri,
          name: asset.fileName ?? "avatar",
          mimeType: asset.mimeType,
          size: asset.fileSize,
        }))
      )
    )
  ),
});

export const deviceCapabilitiesLayer: Layer.Layer<DeviceCapabilities> =
  Layer.mergeAll(storage, temporaryFiles, shareSheet, clipboard, imageLibrary);
