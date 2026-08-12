import { requireNativeModule } from "expo";
import { Platform } from "react-native";

type AppUpdaterModule = {
  installApk(
    apkUri: string,
    expectedApplicationId: string,
    expectedVersionCode: number
  ): Promise<void>;
  sha256(fileUri: string): Promise<string>;
};

const nativeModule =
  Platform.OS === "android"
    ? requireNativeModule<AppUpdaterModule>("DeskohubAppUpdater")
    : undefined;

export async function installApk(
  apkUri: string,
  expectedApplicationId: string,
  expectedVersionCode: number
): Promise<void> {
  if (!nativeModule) {
    throw new Error("APK installation is available only on Android");
  }
  await nativeModule.installApk(
    apkUri,
    expectedApplicationId,
    expectedVersionCode
  );
}

export async function sha256(fileUri: string): Promise<string> {
  if (!nativeModule) {
    throw new Error("Native file hashing is available only on Android");
  }
  return nativeModule.sha256(fileUri);
}
