import { Effect, Option } from "effect";
import { AndroidReleases } from "./android-releases.service";

// Both answers come from a release lookup shared for ten minutes, so the edge
// may keep them as long and serve them stale while it revalidates.
const sharedCaching = {
  "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
};

/**
 * Answers which APK is the latest Android release: the release as JSON, a
 * 404 `no-release` when GitHub has no usable one, or an uncached 502
 * `lookup-failed` when GitHub couldn't be read.
 */
export const respondWithLatestAndroidRelease = Effect.gen(function* () {
  const releases = yield* AndroidReleases;

  return yield* releases.latest.pipe(
    Effect.map(
      Option.match({
        onSome: (release) => Response.json(release, { headers: sharedCaching }),
        onNone: () =>
          Response.json(
            { error: "no-release" },
            { status: 404, headers: sharedCaching }
          ),
      })
    ),
    // The shared lookup already logged the failure with its cause.
    Effect.catchTag("MobileReleaseLookupError", (failure) =>
      Effect.logWarning("Latest Android release lookup failed", {
        cause: failure.cause,
      }).pipe(
        Effect.as(
          Response.json(
            { error: "lookup-failed" },
            { status: 502, headers: { "Cache-Control": "no-store" } }
          )
        )
      )
    )
  );
});
