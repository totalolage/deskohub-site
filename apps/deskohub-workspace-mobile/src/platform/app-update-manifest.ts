export type AndroidReleaseManifest = Readonly<{
  schemaVersion: 1;
  channel: "preview" | "production";
  applicationId: string;
  versionCode: number;
  versionName: string;
  buildSha: string;
  publishedAt: string;
  apk: Readonly<{
    url: string;
    sha256: string;
    sizeBytes: number;
  }>;
}>;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const productionApkUrl = (buildSha: string) =>
  `https://github.com/totalolage/deskohub-site/releases/download/deskohub-workspace-android-${buildSha}/deskohub-workspace.apk`;

export function parseAndroidReleaseManifest(
  value: unknown,
  expectedApplicationId: string,
  expectedChannel: "preview" | "production"
): AndroidReleaseManifest {
  if (!value || typeof value !== "object")
    throw new Error("Invalid release manifest");
  const manifest = value as Partial<AndroidReleaseManifest>;
  const apk = manifest.apk;

  if (
    manifest.schemaVersion !== 1 ||
    manifest.channel !== expectedChannel ||
    manifest.applicationId !== expectedApplicationId ||
    !Number.isSafeInteger(manifest.versionCode) ||
    Number(manifest.versionCode) <= 0 ||
    manifest.versionName !== manifest.buildSha ||
    typeof manifest.buildSha !== "string" ||
    !GIT_SHA_PATTERN.test(manifest.buildSha) ||
    typeof manifest.publishedAt !== "string" ||
    Number.isNaN(Date.parse(manifest.publishedAt)) ||
    !apk ||
    typeof apk.url !== "string" ||
    !SHA256_PATTERN.test(apk.sha256 ?? "") ||
    !Number.isSafeInteger(apk.sizeBytes) ||
    Number(apk.sizeBytes) <= 0
  ) {
    throw new Error("Invalid release manifest");
  }

  const apkUrl = new URL(apk.url);
  if (apkUrl.protocol !== "https:" || apkUrl.username || apkUrl.password) {
    throw new Error("Release APK must use an HTTPS URL without credentials");
  }
  if (
    expectedChannel === "production" &&
    apkUrl.toString() !== productionApkUrl(manifest.buildSha)
  ) {
    throw new Error(
      "Production APK must use its immutable Deskohub release URL"
    );
  }

  return manifest as AndroidReleaseManifest;
}
