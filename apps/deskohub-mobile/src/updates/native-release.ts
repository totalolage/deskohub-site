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
 * What the latest published APK means for this install: a newer version to
 * offer, nothing newer (including no release yet), or `unknown` when the
 * lookup failed or the installed build number can't be read.
 */
export type NativeReleaseCheck =
  | { readonly kind: "newer"; readonly offer: NativeUpdateOffer }
  | { readonly kind: "current" }
  | { readonly kind: "unknown" };

const current: NativeReleaseCheck = { kind: "current" };
const unknown: NativeReleaseCheck = { kind: "unknown" };
const newer = (offer: NativeUpdateOffer): NativeReleaseCheck => ({
  kind: "newer",
  offer,
});

/**
 * Looks up the latest published APK and compares it with the installed
 * build. A 404 means no release yet. A failed lookup, an unreachable server
 * or an unexpected body only make the answer unknown.
 */
export const checkNativeRelease = ({
  installedBuildVersion,
  latestReleaseUrl,
}: {
  readonly installedBuildVersion: string | null;
  readonly latestReleaseUrl: string;
}): Effect.Effect<NativeReleaseCheck, never, HttpClient.HttpClient> =>
  readVersionCode(installedBuildVersion) === undefined
    ? Effect.succeed(unknown)
    : Effect.gen(function* () {
        const response = yield* HttpClient.get(latestReleaseUrl);
        if (response.status === 404) {
          return current;
        }
        const release = yield* HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(LatestNativeRelease))
        );
        const offer = nativeUpdateOffer(installedBuildVersion, release);
        return offer === undefined ? current : newer(offer);
      }).pipe(
        Effect.timeout("15 seconds"),
        Effect.catch((error) =>
          Effect.logDebug("Native release lookup failed", error).pipe(
            Effect.as(unknown)
          )
        )
      );

/**
 * The native offer after a check: a newer release replaces it, a check that
 * found nothing newer withdraws it, and an unknown answer keeps it.
 */
export const nextNativeUpdate = (
  previous: NativeUpdateOffer | undefined,
  check: NativeReleaseCheck
): NativeUpdateOffer | undefined => {
  switch (check.kind) {
    case "newer":
      return check.offer;
    case "current":
      return undefined;
    case "unknown":
      return previous;
  }
};
