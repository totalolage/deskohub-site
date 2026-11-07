---
name: deskohub-mobile-release
description: Mobile release, Android APK, mobile-v tag, mobile-release.yml, versionCode, expo.version bump, mobile CHANGELOG, release signing keystore, apksigner fingerprint, eas build --local, local APK build on a developer machine.
---

# Deskohub mobile release

`.github/workflows/mobile-release.yml` builds the release-signed APK with `eas build --local` and publishes it as the GitHub Release `mobile: vX.Y.Z` with the asset `deskohub-X.Y.Z.apk`. CI and local builds both run `apps/deskohub-mobile/scripts/release/mobile-release.ts`; change the build there, not in the workflow.

## Versions

- `expo.version` in `apps/deskohub-mobile/app.json` is the one version source. `app.config.ts` derives `android.versionCode` from it as `major * 1_000_000 + minor * 1_000 + patch` (minor and patch below 1000, major below 2100), so a later version always installs over an earlier one. Keep `appVersionSource: local` in `eas.json`.
- Versions are plain `X.Y.Z`; the tag is `mobile-vX.Y.Z`, mirroring dhw's `dhw-vX.Y.Z`.
- `app.config.ts` imports no local modules: Expo transpiles only that file, so a TypeScript import from it fails on Node without type stripping. Release scripts import from it instead.

## Cutting a release

1. On a branch, bump `expo.version` and add a section to `apps/deskohub-mobile/CHANGELOG.md` in dhw's Release Please layout (see `apps/dhw/CHANGELOG.md`): `## [X.Y.Z](https://github.com/totalolage/deskohub-site/compare/mobile-vPREVIOUS...mobile-vX.Y.Z) (YYYY-MM-DD)`, then `### Features` and `### Bug Fixes` lists of Conventional Commit subjects. Merge it to `main`.
2. Tag the merged commit and push the tag: `git tag mobile-vX.Y.Z <main sha> && git push origin mobile-vX.Y.Z`.
3. The workflow stops before secrets are used unless the tag matches `expo.version`, the CHANGELOG section exists, and the commit is on `main`. It then builds, checks the APK's package, version name and version code with `aapt2`, checks every signer against the release certificate with `apksigner`, attests provenance, and publishes the release. The release notes are the CHANGELOG section plus the APK and certificate SHA-256 (`renderReleaseNotes` in `scripts/release/release-notes.ts`).

Published releases are immutable: a rerun resumes a draft and leaves a published release alone, so fix a bad release with a new version. Mobile releases are published with `--latest=false`, so dhw stays the repository's latest release; link mobile downloads by tag, not `releases/latest`.

## Pull request dry runs

Pull requests touching `apps/deskohub-mobile/**` or the workflow run the build job without a tag and with `--signing debug`: the script generates a throwaway keystore with `keytool`, signs with it, fails if the release certificate signed the APK, and uploads the APK as the `deskohub-mobile-apk` workflow artifact. Only the tag build step reads `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`, and it runs only on `push`; `scripts/release/mobile-release-workflow.test.ts` fails when a step that reads them loses that condition, or when the two build steps' env differs apart from the keystore. The build job runs `bun test scripts/release` before building, because Mobile CI (`mobile-ci.yml`) doesn't trigger on a change to `mobile-release.yml` alone. A pull request runs its own copy of the workflow, so these conditions prevent mistakes, not a branch that edits them. Fork pull requests skip the job because they get no `EXPO_TOKEN`. The job log prints the `apksigner` signer lines and the job summary shows the release notes.

## Local build

Run from `apps/deskohub-mobile` with the Android SDK (`ANDROID_HOME`), JDK 17, NDK 27.1.12297006 and Node 22 or later:

```bash
EXPO_TOKEN=... ANDROID_KEYSTORE_PATH=<release.keystore> ANDROID_KEYSTORE_PASSWORD=... \
  bun run release:apk --out-dir <dir>
```

`ANDROID_KEYSTORE_BASE64` replaces `ANDROID_KEYSTORE_PATH` in CI. Without the release keystore, `bun run release:apk --signing debug --out-dir <dir>` builds the same APK signed with a throwaway key (JDK `keytool` from `JAVA_HOME` or `PATH`); it refuses `--tag`. The script writes `credentials.json` (git-ignored) for the build and removes it afterwards; it refuses to run when one already exists. It sets `GRADLE_OPTS=-Dorg.gradle.daemon=false -Dorg.gradle.workers.max=4` unless `GRADLE_OPTS` is set, because a Gradle daemon killed mid-build on a shared machine fails the build with "Gradle build daemon disappeared". EAS works in the system temporary directory, so point `TMPDIR` at a disk with room for a full Android build.

The release certificate SHA-256 is `releaseCertificateSha256` in `scripts/release/apk-signature.ts`; `/.well-known/assetlinks.json` and the passkey `android:apk-key-hash` origin use the same key.
