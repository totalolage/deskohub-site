import { describe, expect, test } from "bun:test";
import { parseAndroidReleaseManifest } from "./app-update-manifest";

const release = {
  schemaVersion: 1,
  channel: "production",
  applicationId: "cz.deskohub.workspace",
  versionCode: 42,
  versionName: "a".repeat(40),
  buildSha: "a".repeat(40),
  publishedAt: "2026-08-11T12:00:00.000Z",
  apk: {
    url: `https://github.com/totalolage/deskohub-site/releases/download/deskohub-workspace-android-${"a".repeat(40)}/deskohub-workspace.apk`,
    sha256: "b".repeat(64),
    sizeBytes: 1024,
  },
} as const;

describe("parseAndroidReleaseManifest", () => {
  test("accepts a matching immutable release", () => {
    expect(
      parseAndroidReleaseManifest(
        release,
        "cz.deskohub.workspace",
        "production"
      )
    ).toEqual(release);
  });

  test("rejects a package mismatch", () => {
    expect(() =>
      parseAndroidReleaseManifest(
        release,
        "cz.deskohub.workspace.preview.pr1",
        "production"
      )
    ).toThrow("Invalid release manifest");
  });

  test("rejects an insecure APK URL", () => {
    expect(() =>
      parseAndroidReleaseManifest(
        {
          ...release,
          apk: { ...release.apk, url: "http://example.test/app.apk" },
        },
        "cz.deskohub.workspace",
        "production"
      )
    ).toThrow("Release APK must use an HTTPS URL");
  });
});
