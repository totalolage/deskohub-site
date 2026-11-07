import "server-only";

import { Effect, Match, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  fromSharedSnapshot,
  readSharedSnapshot,
} from "@/shared/backend/shared-snapshot";
import type { AndroidRelease } from "../android-release";
import {
  findLatestAndroidRelease,
  MobileReleaseLookupError,
} from "./android-release-lookup";

export type { AndroidRelease } from "../android-release";
export { MobileReleaseLookupError } from "./android-release-lookup";

/**
 * The latest Android release from GitHub, shared across requests and server
 * instances. `None` means GitHub has no usable mobile release; a lookup that
 * failed, now or within the last couple of minutes, fails.
 */
export const loadLatestAndroidRelease = (): Effect.Effect<
  Option.Option<AndroidRelease>,
  MobileReleaseLookupError
> =>
  fromSharedSnapshot({
    service: "mobile-releases",
    operation: "loadLatestAndroidRelease",
    load: () => loadSharedLatestAndroidRelease(),
  }).pipe(
    Effect.mapError(MobileReleaseLookupError.fromCause),
    Effect.flatMap((snapshot) =>
      Match.value(snapshot).pipe(
        Match.discriminatorsExhaustive("outcome")({
          found: ({ release }) => Effect.succeedSome(release),
          none: () => Effect.succeedNone,
          "lookup-failed": () =>
            Effect.fail(
              MobileReleaseLookupError.fromCause(
                "The shared GitHub release lookup failed recently."
              )
            ),
        })
      )
    )
  );

/**
 * What one shared lookup found. A plain object, not an `Option` or tagged
 * class, because the cache serializes it.
 */
type LatestAndroidReleaseSnapshot =
  | { readonly outcome: "found"; readonly release: AndroidRelease }
  | { readonly outcome: "none" }
  | { readonly outcome: "lookup-failed" };

/**
 * Unauthenticated GitHub API requests are limited to 60 an hour per IP
 * address, and one lookup takes two to four. Sharing a result for ten
 * minutes keeps refreshes far below that. After that, the result is served
 * while a refresh runs; a refresh that fails replaces it with the failure,
 * so a GitHub outage shows as failed lookups, not as an old release.
 */
const releaseLifetime = { stale: 300, revalidate: 600, expire: 86_400 };

/**
 * A failed lookup is shared as a value, not thrown: under Cache Components a
 * throwing `"use cache"` function fails a prerender even when its caller
 * catches it. It refreshes after two minutes; its expiry stays at the
 * five-minute prerender threshold so a page without a Suspense boundary
 * keeps it in the static shell.
 */
const failureLifetime = { stale: 30, revalidate: 120, expire: 300 };

async function loadSharedLatestAndroidRelease(): Promise<LatestAndroidReleaseSnapshot> {
  "use cache: remote";

  return await readSharedSnapshot(
    "mobile-releases.latest-android.load",
    findLatestAndroidRelease().pipe(
      Effect.map(
        Option.match({
          onNone: (): LatestAndroidReleaseSnapshot => ({ outcome: "none" }),
          onSome: (release): LatestAndroidReleaseSnapshot => ({
            outcome: "found",
            release,
          }),
        })
      ),
      Effect.provide(FetchHttpClient.layer)
    ),
    {
      complete: { lifetime: releaseLifetime },
      failure: {
        failureCode: "mobile_releases.latest_android.lookup_failed",
        fallback: (): LatestAndroidReleaseSnapshot => ({
          outcome: "lookup-failed",
        }),
        lifetime: failureLifetime,
      },
    }
  );
}
