import "server-only";

import { Context, type Effect, Layer, type Option } from "effect";
import type { AndroidRelease } from "../android-release";
import type { MobileReleaseLookupError } from "./android-release-lookup";
import { loadLatestAndroidRelease } from "./latest-android-release.server";

interface IAndroidReleases {
  /** The newest APK GitHub offers; `None` when no mobile release is usable. */
  readonly latest: Effect.Effect<
    Option.Option<AndroidRelease>,
    MobileReleaseLookupError
  >;
}

/** The Android releases the mobile app and the download page offer. */
export class AndroidReleases extends Context.Service<
  AndroidReleases,
  IAndroidReleases
>()("@deskohub-workspace/mobile-releases/AndroidReleases") {
  static Default = Layer.sync(this, () => ({
    latest: loadLatestAndroidRelease(),
  }));
}
