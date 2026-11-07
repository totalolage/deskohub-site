import { Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

/**
 * The fields of the Workspace's `GET /api/mobile/releases/latest` reply the
 * app compares against. The reply carries more (APK URL, size, hashes); the
 * app ignores them and links to the `/android` page instead.
 */
const LatestNativeRelease = Schema.Struct({
  versionName: Schema.String,
  versionCode: Schema.Int,
});

export type NativeUpdateOffer = {
  readonly versionName: string;
  readonly versionCode: number;
};

const versionCodePattern = /^\d+$/;

const readVersionCode = (buildVersion: string | null): number | undefined =>
  buildVersion !== null && versionCodePattern.test(buildVersion)
    ? Number(buildVersion)
    : undefined;

/**
 * Offers the latest release when its Android version code is larger than
 * the installed build's. `installedBuildVersion` is the native build number
 * (`expo-application`'s `nativeBuildVersion`), which an over-the-air update
 * doesn't change.
 */
export const nativeUpdateOffer = (
  installedBuildVersion: string | null,
  release: NativeUpdateOffer
): NativeUpdateOffer | undefined => {
  const installed = readVersionCode(installedBuildVersion);
  return installed !== undefined && release.versionCode > installed
    ? { versionName: release.versionName, versionCode: release.versionCode }
    : undefined;
};

/**
 * Looks up the latest published APK and offers it when it is newer than the
 * installed build. No release yet (404), a failed lookup, an unreachable
 * server or an unexpected body all mean no offer.
 */
export const findNativeUpdate = ({
  installedBuildVersion,
  latestReleaseUrl,
}: {
  readonly installedBuildVersion: string | null;
  readonly latestReleaseUrl: string;
}): Effect.Effect<
  NativeUpdateOffer | undefined,
  never,
  HttpClient.HttpClient
> =>
  readVersionCode(installedBuildVersion) === undefined
    ? Effect.undefined
    : HttpClient.get(latestReleaseUrl).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(LatestNativeRelease)),
        Effect.timeout("15 seconds"),
        Effect.map((release) =>
          nativeUpdateOffer(installedBuildVersion, release)
        ),
        Effect.catch((error) =>
          Effect.logDebug("Native release lookup found no update", error).pipe(
            Effect.as(undefined)
          )
        )
      );
