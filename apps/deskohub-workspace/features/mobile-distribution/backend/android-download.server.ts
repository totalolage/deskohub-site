import "server-only";

import { Cause, Effect, Option } from "effect";
import "@/shared/polyfills/temporal";
import { loadLatestAndroidRelease } from "@/features/mobile-releases/backend/latest-android-release.server";
import { findNextControlFlow } from "@/shared/backend/workspace-effect";
import type { AndroidDownload } from "../android-download";

/**
 * What the `/android` page offers. A failed lookup becomes the `unavailable`
 * state, so the page and its Markdown still render without GitHub. Next.js
 * control flow the lookup carries, such as a prerender bailout, propagates.
 *
 * The failure is not logged here: the page runs this outside any cache
 * scope, where a prerender fails on a read of the current time, and every
 * Effect log line reads it. The shared lookup logs the failure inside its
 * cache scope instead.
 */
export const loadAndroidDownload: Effect.Effect<AndroidDownload> =
  Effect.suspend(() => loadLatestAndroidRelease()).pipe(
    Effect.map(
      Option.match({
        onNone: (): AndroidDownload => ({ kind: "none" }),
        onSome: (release): AndroidDownload => ({ kind: "release", release }),
      })
    ),
    Effect.catchTag("MobileReleaseLookupError", (error) =>
      Option.fromNullishOr(findNextControlFlow(Cause.fail(error))).pipe(
        Option.match({
          onNone: () =>
            Effect.succeed<AndroidDownload>({ kind: "unavailable" }),
          onSome: () => Effect.die(error),
        })
      )
    ),
    Effect.withSpan("MobileDistribution.loadAndroidDownload")
  );
