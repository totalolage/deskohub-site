import { nativeApp } from "@/features/account/backend/auth/native-app";
import type { GitHubRelease } from "./android-release";

const releasesUrl = "https://github.com/totalolage/deskohub-site/releases";

/** The version code the mobile app derives from a version name. */
const versionCodeOf = (version: string) => {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return major * 1_000_000 + minor * 1_000 + patch;
};

/**
 * Release notes as the mobile release workflow renders them: a CHANGELOG
 * section, then the Android APK section. A `null` field leaves its line out.
 */
export const androidReleaseNotes = (
  version: string,
  {
    apkFileName = `deskohub-${version}.apk`,
    apkSha256 = "a".repeat(64),
    certificateSha256 = nativeApp.androidReleaseCertificate,
  }: {
    readonly apkFileName?: string;
    readonly apkSha256?: string | null;
    readonly certificateSha256?: string;
  } = {}
) =>
  [
    `## [${version}](${releasesUrl}/compare) (2026-11-07)`,
    "",
    "### Features",
    "",
    "* **mobile:** offer native updates",
    "",
    "### Android APK",
    "",
    `* File: \`${apkFileName}\` (version code ${versionCodeOf(version)})`,
    ...(apkSha256 === null ? [] : [`* File SHA-256: \`${apkSha256}\``]),
    `* Signing certificate SHA-256: \`${certificateSha256}\``,
    "",
    `Check the signature before installing: \`apksigner verify --print-certs ${apkFileName}\` prints the same certificate SHA-256 without colons.`,
    "",
  ].join("\n");

/** A published mobile release as the GitHub REST API describes it. */
export const githubMobileRelease = (
  version: string,
  overrides: Partial<GitHubRelease> = {}
): GitHubRelease => ({
  tag_name: `mobile-v${version}`,
  name: `mobile: v${version}`,
  body: androidReleaseNotes(version),
  draft: false,
  prerelease: false,
  html_url: `${releasesUrl}/tag/mobile-v${version}`,
  published_at: "2026-11-07T09:30:00Z",
  assets: [
    {
      name: `deskohub-${version}.apk`,
      size: 54_321_000,
      browser_download_url: `${releasesUrl}/download/mobile-v${version}/deskohub-${version}.apk`,
    },
  ],
  ...overrides,
});
