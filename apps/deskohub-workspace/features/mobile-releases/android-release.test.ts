import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { nativeApp } from "@/features/account/backend/auth/native-app";
import {
  type GitHubRelease,
  selectLatestAndroidRelease,
} from "./android-release";
import {
  androidReleaseNotes,
  githubMobileRelease,
} from "./android-release.test-utils";

describe("selectLatestAndroidRelease", () => {
  test("finds nothing in an empty list", () => {
    expect(selectLatestAndroidRelease([])).toEqual(Option.none());
  });

  test("maps a published mobile release to the Android release it offers", () => {
    expect(selectLatestAndroidRelease([githubMobileRelease("1.2.3")])).toEqual(
      Option.some({
        versionName: "1.2.3",
        versionCode: 1_002_003,
        apkUrl:
          "https://github.com/totalolage/deskohub-site/releases/download/mobile-v1.2.3/deskohub-1.2.3.apk",
        apkSizeBytes: 54_321_000,
        apkSha256: "a".repeat(64),
        certificateSha256: nativeApp.androidReleaseCertificate,
        publishedAt: "2026-11-07T09:30:00Z",
        releaseUrl:
          "https://github.com/totalolage/deskohub-site/releases/tag/mobile-v1.2.3",
      })
    );
  });

  test("skips drafts and prereleases", () => {
    expect(
      selectLatestAndroidRelease([
        githubMobileRelease("1.0.0"),
        githubMobileRelease("1.1.0", { draft: true }),
        githubMobileRelease("1.2.0", { prerelease: true }),
      ])
    ).toEqual(Option.some(expect.objectContaining({ versionName: "1.0.0" })));
  });

  test("skips releases of other series and malformed mobile tags", () => {
    for (const tag_name of [
      "dhw-v9.0.0",
      "mobile-v1.2",
      "mobile-v1.2.3-beta.1",
      "mobile-v01.2.3",
      "mobile-v9007199254740992.0.0",
      "mobile-1.2.3",
    ]) {
      expect(
        selectLatestAndroidRelease([githubMobileRelease("1.2.3", { tag_name })])
      ).toEqual(Option.none());
    }
  });

  test("skips a release whose title names another version or series", () => {
    for (const name of ["mobile: v1.2.4", "dhw: v1.2.3", null]) {
      expect(
        selectLatestAndroidRelease([githubMobileRelease("1.2.3", { name })])
      ).toEqual(Option.none());
    }
  });

  test("skips a release without its version's APK asset", () => {
    expect(
      selectLatestAndroidRelease([
        githubMobileRelease("1.2.3", {
          assets: [
            {
              name: "deskohub-1.2.2.apk",
              size: 1,
              browser_download_url:
                "https://github.com/totalolage/deskohub-site/releases/download/mobile-v1.2.3/deskohub-1.2.2.apk",
            },
          ],
        }),
      ])
    ).toEqual(Option.none());
  });

  test("skips a release signed with another certificate", () => {
    expect(
      selectLatestAndroidRelease([
        githubMobileRelease("1.2.3", {
          body: androidReleaseNotes("1.2.3", {
            certificateSha256: nativeApp.androidReleaseCertificate.replace(
              /^69/,
              "70"
            ),
          }),
        }),
      ])
    ).toEqual(Option.none());
  });

  test("skips a release whose notes lack the APK file's SHA-256", () => {
    expect(
      selectLatestAndroidRelease([
        githubMobileRelease("1.2.3", {
          body: androidReleaseNotes("1.2.3", { apkSha256: null }),
        }),
      ])
    ).toEqual(Option.none());
  });

  test("skips a release whose notes lack the Android APK section", () => {
    expect(
      selectLatestAndroidRelease([
        githubMobileRelease("1.2.3", { body: "## 1.2.3\n" }),
        githubMobileRelease("1.2.4", { body: null }),
      ])
    ).toEqual(Option.none());
  });

  test("reads the version code only from the line naming the release's APK", () => {
    expect(
      selectLatestAndroidRelease([
        githubMobileRelease("1.2.3", {
          body: androidReleaseNotes("1.2.3", {
            apkFileName: "deskohub-1.2.2.apk",
          }),
        }),
      ])
    ).toEqual(Option.none());
  });

  test("reads notes with Windows line endings", () => {
    expect(
      selectLatestAndroidRelease([
        githubMobileRelease("1.2.3", {
          body: androidReleaseNotes("1.2.3").replaceAll("\n", "\r\n"),
        }),
      ])
    ).toEqual(Option.some(expect.objectContaining({ versionCode: 1_002_003 })));
  });

  test("offers the highest version, compared numerically", () => {
    const releases: GitHubRelease[] = [
      githubMobileRelease("1.9.0"),
      githubMobileRelease("1.10.0"),
      githubMobileRelease("1.2.0"),
    ];

    expect(selectLatestAndroidRelease(releases)).toEqual(
      Option.some(
        expect.objectContaining({
          versionName: "1.10.0",
          versionCode: 1_010_000,
        })
      )
    );
  });

  // The `/android` page reads it with `Date.parse` (see
  // `getAndroidReleaseFacts`), so a value that function can't read is skipped.
  test("skips a release whose publish time isn't an ISO instant with an offset", () => {
    for (const published_at of [
      "2026-11-07T09:30:00",
      "2026-11-07T09:30:00Z[UTC]",
      "Sat, 07 Nov 2026 09:30:00 GMT",
      "not a date",
    ]) {
      expect(
        selectLatestAndroidRelease([
          githubMobileRelease("2.0.0", { published_at }),
          githubMobileRelease("1.10.0"),
        ])
      ).toEqual(
        Option.some(expect.objectContaining({ versionName: "1.10.0" }))
      );
    }
  });

  test("falls back to the highest usable release when a newer one is unusable", () => {
    expect(
      selectLatestAndroidRelease([
        githubMobileRelease("2.0.0", { body: "## 2.0.0\n" }),
        githubMobileRelease("1.10.0"),
      ])
    ).toEqual(Option.some(expect.objectContaining({ versionName: "1.10.0" })));
  });
});
