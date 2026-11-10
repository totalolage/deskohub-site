import { Array as Arr, Option, Order, Schema } from "effect";
import { compare, valid } from "semver";
import { nativeApp } from "@/features/account/backend/auth/native-app";
import { parseInstant } from "@/shared/utils/temporal";

/** The APK a published mobile release offers Android users. */
export type AndroidRelease = {
  readonly versionName: string;
  readonly versionCode: number;
  readonly apkUrl: string;
  readonly apkSizeBytes: number;
  /** Lowercase hex SHA-256 of the APK file. */
  readonly apkSha256: string;
  /** Always `nativeApp.androidReleaseCertificate`. */
  readonly certificateSha256: string;
  /** ISO 8601 instant GitHub published the release at. */
  readonly publishedAt: string;
  readonly releaseUrl: string;
};

/** One file attached to a GitHub release. */
const GitHubReleaseAsset = Schema.Struct({
  name: Schema.String,
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  browser_download_url: Schema.String,
});

/**
 * A GitHub release, as the REST API's release endpoints describe it, reduced
 * to the fields the Android release lookup reads.
 */
export const GitHubRelease = Schema.Struct({
  tag_name: Schema.String,
  name: Schema.NullOr(Schema.String),
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  html_url: Schema.String,
  published_at: Schema.NullOr(Schema.String),
  assets: Schema.Array(GitHubReleaseAsset),
});
export type GitHubRelease = typeof GitHubRelease.Type;

// Mobile releases are tagged `mobile-vX.Y.Z` with plain numeric parts.
const mobileReleaseTagPattern =
  /^mobile-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;

/** The version a mobile release tag names, if the tag is one. */
export const mobileReleaseVersion = (tag: string): Option.Option<string> =>
  Option.fromNullishOr(mobileReleaseTagPattern.exec(tag)?.[1]).pipe(
    // semver can't compare a part above Number.MAX_SAFE_INTEGER.
    Option.filter((version) => valid(version) !== null)
  );

/** Orders version names by semantic version, so 1.10.0 follows 1.9.0. */
export const mobileReleaseVersionOrder: Order.Order<string> = compare;

/**
 * The newest release Android users can install: published, tagged and titled
 * as a mobile release, carrying its APK, and documenting the APK's version
 * code, file SHA-256 and the release signing certificate in its notes. A
 * release missing any of these, or naming another certificate, is skipped.
 */
export const selectLatestAndroidRelease = (
  releases: ReadonlyArray<GitHubRelease>
): Option.Option<AndroidRelease> => {
  const offered = releases.flatMap((release) =>
    Option.toArray(toAndroidRelease(release))
  );
  return Arr.isReadonlyArrayNonEmpty(offered)
    ? Option.some(Arr.max(offered, byVersion))
    : Option.none();
};

const byVersion = Order.mapInput(
  mobileReleaseVersionOrder,
  (release: AndroidRelease) => release.versionName
);

const toAndroidRelease = (
  release: GitHubRelease
): Option.Option<AndroidRelease> =>
  Option.gen(function* () {
    if (release.draft || release.prerelease) return yield* Option.none();
    const versionName = yield* mobileReleaseVersion(release.tag_name);
    if (release.name !== `mobile: v${versionName}`) {
      return yield* Option.none();
    }
    const apkFileName = `deskohub-${versionName}.apk`;
    const apk = yield* Arr.findFirst(
      release.assets,
      (asset) => asset.name === apkFileName
    );
    const notes = yield* readAndroidApkNotes(release.body ?? "");
    if (
      notes.apkFileName !== apkFileName ||
      notes.certificateSha256 !== nativeApp.androidReleaseCertificate
    ) {
      return yield* Option.none();
    }
    const publishedAt = yield* Option.fromNullOr(release.published_at).pipe(
      Option.filter(isPublishTime)
    );

    return {
      versionName,
      versionCode: notes.versionCode,
      apkUrl: apk.browser_download_url,
      apkSizeBytes: apk.size,
      apkSha256: notes.apkSha256,
      certificateSha256: notes.certificateSha256,
      publishedAt,
      releaseUrl: release.html_url,
    };
  });

/**
 * An ISO instant with an offset that `Date.parse` also reads: the `/android`
 * page parses it that way, since the Temporal polyfill's parser reads the
 * current time, which fails its prerender.
 */
const isPublishTime = (value: string) =>
  Option.isSome(parseInstant(value)) && !Number.isNaN(Date.parse(value));

// The lines `renderReleaseNotes` in apps/deskohub-mobile/scripts/release
// writes under `### Android APK`.
const apkFileLine = /^\* File: `([^`]+)` \(version code ([1-9]\d{0,9})\)$/;
const apkSha256Line = /^\* File SHA-256: `([0-9a-f]{64})`$/;
const certificateSha256Line =
  /^\* Signing certificate SHA-256: `((?:[0-9A-F]{2}:){31}[0-9A-F]{2})`$/;

/** The facts the `### Android APK` section of a release's notes states. */
const readAndroidApkNotes = (body: string) => {
  const lines = body.split(/\r?\n/);
  const sectionStart = lines.indexOf("### Android APK");
  if (sectionStart === -1) return Option.none();
  const section = lines.slice(sectionStart + 1);
  const sectionEnd = section.findIndex((line) => /^#{1,3} /.test(line));
  const sectionLines =
    sectionEnd === -1 ? section : section.slice(0, sectionEnd);
  const capture = (pattern: RegExp, group = 1) =>
    Option.fromNullishOr(
      sectionLines.map((line) => pattern.exec(line)?.[group]).find(Boolean)
    );

  return Option.all({
    apkFileName: capture(apkFileLine),
    versionCode: capture(apkFileLine, 2).pipe(
      Option.map(Number),
      Option.filter(Number.isSafeInteger)
    ),
    apkSha256: capture(apkSha256Line),
    certificateSha256: capture(certificateSha256Line),
  });
};
