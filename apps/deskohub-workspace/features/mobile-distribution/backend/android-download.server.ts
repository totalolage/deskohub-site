import "server-only";

import { Effect, Option } from "effect";
import "@/shared/polyfills/temporal";
import { loadLatestAndroidRelease } from "@/features/mobile-releases/backend/latest-android-release.server";
import type { AndroidDownload } from "../android-download";

/**
 * What the `/android` page offers. A failed lookup becomes the `unavailable`
 * state, so the page and its Markdown still render without GitHub.
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
      Effect.logWarning("Android release lookup failed", { error }).pipe(
        Effect.as<AndroidDownload>({ kind: "unavailable" })
      )
    ),
    Effect.withSpan("MobileDistribution.loadAndroidDownload")
  );
