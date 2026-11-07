import AsyncStorage from "@react-native-async-storage/async-storage";
import { Effect, Layer, Option } from "effect";
import * as ExpoClipboard from "expo-clipboard";
import { Directory, File, Paths } from "expo-file-system";
import * as ExpoImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";
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

// One cache subdirectory holds every file the app shares, so sign-out can
// remove them all at once.
const shareDirectory = () => new Directory(Paths.cache, "deskohub-share");

const temporaryFiles = Layer.succeed(TemporaryFiles, {
  write: (name, bytes) =>
    attempt("temporary-files", async () => {
      const directory = shareDirectory();
      if (!directory.exists) directory.create({ intermediates: true });
      const file = new File(directory, name);
      if (file.exists) file.delete();
      await file.write(bytes);
      return file.uri;
    }),
  remove: (uri) =>
    attempt("temporary-files", () => {
      const file = new File(uri);
      if (file.exists) file.delete();
    }).pipe(Effect.ignore),
  sweep: attempt("temporary-files", () => {
    const directory = shareDirectory();
    if (directory.exists) directory.delete();
  }).pipe(Effect.ignore),
});

const shareSheet = Layer.succeed(ShareSheet, {
  shareFile: ({ uri, mimeType }) =>
    attempt("share", () => Sharing.shareAsync(uri, { mimeType })),
  shareLink: ({ url, message }) =>
    attempt("share", () =>
      Share.share({ message: message ? `${message}\n${url}` : url, url })
    ).pipe(Effect.asVoid),
});

const clipboard = Layer.succeed(Clipboard, {
  copy: (text, { sensitive }) =>
    attempt("clipboard", () =>
      ExpoClipboard.setStringAsync(text, {
        android: { isSensitive: sensitive },
      })
    ).pipe(Effect.asVoid),
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
