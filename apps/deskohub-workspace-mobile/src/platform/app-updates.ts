import { installApk, sha256 } from "@deskohub/app-updater";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import {
  type AndroidReleaseManifest,
  parseAndroidReleaseManifest,
} from "./app-update-manifest";

const READY_UPDATE_KEY = "deskohub.workspace.ready-apk.v1";
const DOWNLOAD_DIRECTORY = `${FileSystem.cacheDirectory ?? ""}deskohub-updates/`;

type MobileExtra = Readonly<{
  applicationId?: string;
  buildChannel?: "preview" | "production";
  releaseManifestUrl?: string;
}>;

export type ReadyApkUpdate = Readonly<{
  manifest: AndroidReleaseManifest;
  localUri: string;
}>;

const extra = (Constants.expoConfig?.extra ?? {}) as MobileExtra;

function currentVersionCode(): number {
  const raw = Number.parseInt(Application.nativeBuildVersion ?? "", 10);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 1;
}

async function readReadyUpdate(): Promise<ReadyApkUpdate | undefined> {
  const serialized = await AsyncStorage.getItem(READY_UPDATE_KEY);
  if (!serialized) return undefined;
  try {
    const value = JSON.parse(serialized) as ReadyApkUpdate;
    const info = await FileSystem.getInfoAsync(value.localUri);
    return info.exists ? value : undefined;
  } catch {
    await AsyncStorage.removeItem(READY_UPDATE_KEY);
    return undefined;
  }
}

export async function checkForSmallUpdate(): Promise<boolean> {
  if (!Updates.isEnabled) return false;
  const update = await Updates.checkForUpdateAsync();
  if (!update.isAvailable) return false;
  await Updates.fetchUpdateAsync();
  return true;
}

export async function checkAndDownloadApkUpdate(): Promise<
  | { kind: "unsupported" }
  | { kind: "current" }
  | { kind: "waiting_for_wifi"; manifest: AndroidReleaseManifest }
  | { kind: "ready"; update: ReadyApkUpdate }
> {
  if (Platform.OS !== "android") return { kind: "unsupported" };
  const applicationId = Application.applicationId;
  const channel = extra.buildChannel;
  const manifestUrl = extra.releaseManifestUrl;
  if (!applicationId || !channel || !manifestUrl)
    return { kind: "unsupported" };

  const existing = await readReadyUpdate();
  if (existing && existing.manifest.versionCode > currentVersionCode()) {
    return { kind: "ready", update: existing };
  }

  const response = await fetch(manifestUrl, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Release check failed (${response.status})`);
  const manifest = parseAndroidReleaseManifest(
    await response.json(),
    applicationId,
    channel
  );
  if (manifest.versionCode <= currentVersionCode()) return { kind: "current" };

  const network = await NetInfo.fetch();
  if (network.type !== "wifi" || network.isConnected !== true) {
    return { kind: "waiting_for_wifi", manifest };
  }

  await FileSystem.makeDirectoryAsync(DOWNLOAD_DIRECTORY, {
    intermediates: true,
  });
  const localUri = `${DOWNLOAD_DIRECTORY}${manifest.buildSha}.apk`;
  let leftWifi = false;
  const download = FileSystem.createDownloadResumable(
    manifest.apk.url,
    localUri
  );
  const unsubscribe = NetInfo.addEventListener((state) => {
    if (state.type === "wifi" && state.isConnected === true) return;
    leftWifi = true;
    void download.pauseAsync();
  });
  let result: FileSystem.FileSystemDownloadResult | undefined;
  try {
    result = await download.downloadAsync();
  } catch (cause) {
    if (!leftWifi) throw cause;
  } finally {
    unsubscribe();
  }
  if (leftWifi || !result) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    return { kind: "waiting_for_wifi", manifest };
  }
  const info = await FileSystem.getInfoAsync(result.uri);
  if (!info.exists || info.size !== manifest.apk.sizeBytes) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new Error("Downloaded APK size does not match its manifest");
  }
  const digest = await sha256(result.uri);
  if (digest !== manifest.apk.sha256) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new Error("Downloaded APK checksum does not match its manifest");
  }

  const update = { manifest, localUri: result.uri } satisfies ReadyApkUpdate;
  await AsyncStorage.setItem(READY_UPDATE_KEY, JSON.stringify(update));
  return { kind: "ready", update };
}

export async function installReadyApkUpdate(): Promise<boolean> {
  const update = await readReadyUpdate();
  if (!update) return false;
  await installApk(
    update.localUri,
    update.manifest.applicationId,
    update.manifest.versionCode
  );
  return true;
}
