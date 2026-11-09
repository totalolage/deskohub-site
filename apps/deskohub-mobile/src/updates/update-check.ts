import { Effect } from "effect";
import type { HttpClient } from "effect/unstable/http";
import { checkNativeRelease, type NativeReleaseCheck } from "./native-release";
import {
  findReadyUpdate,
  type OtaUpdateSource,
  type ReadyUpdate,
} from "./ota-update";

/**
 * The app checks on launch and whenever it returns to the foreground, at most
 * once per interval, so switching apps back and forth doesn't poll the server.
 */
export const updateCheckIntervalMs = 15 * 60 * 1000;

export const isUpdateCheckDue = (
  lastCheckStartedAt: number | undefined,
  now: number
): boolean =>
  lastCheckStartedAt === undefined ||
  now < lastCheckStartedAt ||
  now - lastCheckStartedAt >= updateCheckIntervalMs;

export type UpdateCheckPlan = {
  readonly otaUpdate: boolean;
  readonly nativeRelease: boolean;
};

/**
 * Which checks apply. Web is served fresh by the Workspace. Only Android
 * installs APKs, so iOS checks only for JS updates. `otaUpdatesEnabled` is
 * `Updates.isEnabled`, false when the build disables or misconfigures
 * expo-updates.
 */
export const planUpdateCheck = ({
  platform,
  otaUpdatesEnabled,
}: {
  readonly platform: string;
  readonly otaUpdatesEnabled: boolean;
}): UpdateCheckPlan => ({
  otaUpdate: platform !== "web" && otaUpdatesEnabled,
  nativeRelease: platform === "android",
});

/**
 * Runs the planned checks side by side and reports each result as soon as it
 * arrives, so a slow update download doesn't hold back a native offer.
 * Neither check can fail the other.
 */
export const runUpdateCheck = ({
  plan,
  updates,
  installedBuildVersion,
  latestReleaseUrl,
  onReadyUpdate,
  onNativeRelease,
}: {
  readonly plan: UpdateCheckPlan;
  readonly updates: OtaUpdateSource;
  readonly installedBuildVersion: string | null;
  readonly latestReleaseUrl: string;
  readonly onReadyUpdate: (update: ReadyUpdate | undefined) => void;
  readonly onNativeRelease: (check: NativeReleaseCheck) => void;
}): Effect.Effect<void, never, HttpClient.HttpClient> =>
  Effect.all(
    [
      plan.otaUpdate
        ? findReadyUpdate(updates).pipe(
            Effect.tap((update) => Effect.sync(() => onReadyUpdate(update)))
          )
        : Effect.void,
      plan.nativeRelease
        ? checkNativeRelease({ installedBuildVersion, latestReleaseUrl }).pipe(
            Effect.tap((check) => Effect.sync(() => onNativeRelease(check)))
          )
        : Effect.void,
    ],
    { concurrency: "unbounded", discard: true }
  );
