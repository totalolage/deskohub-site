import { Data, Effect, Option } from "effect";

// TODO(#994): delete this placeholder once `features/mobile-releases` lands.
// Import `AndroidRelease`, `MobileReleaseLookupError` and
// `loadLatestAndroidRelease` from
// `@/features/mobile-releases/backend/latest-android-release.server`, and
// `ANDROID_PACKAGE_ID` and `RELEASE_CERTIFICATE_SHA256` from
// `@/features/mobile-releases/android-app`. Until then the lookup finds no
// release, so the page shows its coming-soon state.

export const ANDROID_PACKAGE_ID = "cz.deskohub.workspace";

export const RELEASE_CERTIFICATE_SHA256 =
  "69:42:8E:71:15:01:75:FC:0E:84:52:03:54:42:A8:A1:19:86:4C:21:D0:AB:E9:C8:E2:33:A0:54:2E:C9:4A:A0";

export interface AndroidRelease {
  readonly versionName: string;
  readonly versionCode: number;
  readonly apkUrl: string;
  readonly apkSizeBytes: number;
  readonly apkSha256: string;
  readonly certificateSha256: string;
  /** ISO instant. */
  readonly publishedAt: string;
  readonly releaseUrl: string;
}

export class MobileReleaseLookupError extends Data.TaggedError(
  "MobileReleaseLookupError"
)<{ readonly cause: unknown }> {}

export const loadLatestAndroidRelease = (): Effect.Effect<
  Option.Option<AndroidRelease>,
  MobileReleaseLookupError
> => Effect.succeed(Option.none());
