import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";

const [apkPath, outputPath] = process.argv.slice(2);
if (!apkPath || !outputPath) {
  throw new Error("Usage: create-release-manifest.ts <apk-path> <output-path>");
}

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const versionCode = Number.parseInt(required("DW_ANDROID_VERSION_CODE"), 10);
if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
  throw new Error("DW_ANDROID_VERSION_CODE must be a positive integer");
}

const buildSha = required("DW_BUILD_TAG");
if (!/^[0-9a-f]{40}$/.test(buildSha)) {
  throw new Error("DW_BUILD_TAG must be a full lowercase Git SHA");
}

const channel = required("DW_BUILD_CHANNEL");
if (channel !== "preview" && channel !== "production") {
  throw new Error("DW_BUILD_CHANNEL must be preview or production");
}

const apkUrl = new URL(required("DW_ANDROID_APK_URL"));
if (apkUrl.protocol !== "https:")
  throw new Error("DW_ANDROID_APK_URL must use HTTPS");

const contents = await readFile(apkPath);
const metadata = await stat(apkPath);
const manifest = {
  schemaVersion: 1,
  channel,
  applicationId: required("DW_ANDROID_APPLICATION_ID"),
  versionCode,
  versionName:
    channel === "preview" ? buildSha : required("DW_ANDROID_VERSION_NAME"),
  buildSha,
  publishedAt: process.env.DW_PUBLISHED_AT?.trim() || new Date().toISOString(),
  apk: {
    url: apkUrl.toString(),
    sha256: createHash("sha256").update(contents).digest("hex"),
    sizeBytes: metadata.size,
  },
} as const;

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
