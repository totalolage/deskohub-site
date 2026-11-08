import { Effect } from "effect";
import { AndroidReleases } from "@/features/mobile-releases/backend/android-releases.service";
import { respondWithLatestAndroidRelease } from "@/features/mobile-releases/backend/latest-android-release-response";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

/** The latest Android APK, for the mobile app's native update prompt. */
export const GET = defineWorkspaceRoute(
  {
    operation: "mobileLatestAndroidRelease",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (_request: Request) =>
    respondWithLatestAndroidRelease.pipe(
      Effect.provide(AndroidReleases.Default)
    )
);
