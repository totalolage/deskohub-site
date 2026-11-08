import { formatCertificateSha256 } from "./apk-signature";

// CHANGELOG.md follows the Release Please layout that apps/dhw/CHANGELOG.md
// uses: one `## [X.Y.Z](compare link) (date)` section per release, newest first.
// A plain `## X.Y.Z` heading is accepted too.
const versionHeading = /^## \[?(\d+\.\d+\.\d+)\]?(?:[\s(]|$)/;

export const changelogSection = (
  changelog: string,
  version: string
): string | undefined => {
  const lines = changelog.split("\n");
  const start = lines.findIndex(
    (line) => versionHeading.exec(line)?.[1] === version
  );
  if (start === -1) {
    return undefined;
  }
  const nextOffset = lines
    .slice(start + 1)
    .findIndex((line) => line.startsWith("## "));
  const end = nextOffset === -1 ? lines.length : start + 1 + nextOffset;
  return lines.slice(start, end).join("\n").trim();
};

export type ReleaseNotesInput = {
  readonly apkFileName: string;
  readonly apkSha256: string;
  readonly certificateSha256: string;
  readonly changelog: string | undefined;
  readonly version: string;
  readonly versionCode: number;
};

export const renderReleaseNotes = ({
  apkFileName,
  apkSha256,
  certificateSha256,
  changelog,
  version,
  versionCode,
}: ReleaseNotesInput): string =>
  [
    changelog ?? `## ${version}`,
    "",
    "### Android APK",
    "",
    `* File: \`${apkFileName}\` (version code ${versionCode})`,
    `* File SHA-256: \`${apkSha256}\``,
    `* Signing certificate SHA-256: \`${formatCertificateSha256(certificateSha256)}\``,
    "",
    `Check the signature before installing: \`apksigner verify --print-certs ${apkFileName}\` prints the same certificate SHA-256 without colons.`,
    "",
  ].join("\n");
